import os
import cv2
import numpy as np
import pytesseract
import matplotlib
matplotlib.use('Agg')  # Configurar Matplotlib para backend no interactivo
import matplotlib.pyplot as plt
from flask import Flask, request, jsonify, render_template, send_from_directory
from PIL import Image
from tensorflow.keras.models import load_model
from tensorflow.keras.losses import MeanSquaredError
from sklearn.preprocessing import MinMaxScaler
import io
import base64

app = Flask(__name__)

# Ruta de Tesseract
pytesseract.pytesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'

# Configuración de directorios
UPLOAD_FOLDER = os.path.join(os.getcwd(), 'uploads')
GRAPH_FOLDER = os.path.join(os.getcwd(), 'static', 'graphs')
for folder in [UPLOAD_FOLDER, GRAPH_FOLDER]:
    if not os.path.exists(folder):
        os.makedirs(folder)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# Cargar modelo LSTM previamente entrenado
model7 = load_model('modelo7_lstm_entrenadov2.h5', custom_objects={'mse': MeanSquaredError()})
scaler_y = MinMaxScaler()

# Variable global para guardar datos actuales
current_results = {}

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/file-upload')
def file_upload():
    return render_template('file-upload.html')

@app.route('/graphs/<path:filename>')
def serve_graph(filename):
    """Servir gráficos generados."""
    return send_from_directory(GRAPH_FOLDER, filename)

@app.route('/upload', methods=['POST'])
def upload_image():
    """Procesa la imagen subida."""
    if 'image' not in request.files:
        return jsonify({'error': 'No se subió ninguna imagen'}), 400

    file = request.files['image']
    if file.filename == '':
        return jsonify({'error': 'No se seleccionó ninguna imagen'}), 400

    file_path = os.path.join(app.config['UPLOAD_FOLDER'], file.filename)
    file.save(file_path)

    return process_image(file_path)

@app.route('/predict-from-screenshot', methods=['POST'])
def predict_from_screenshot():
    """Procesa una captura de pantalla enviada como base64."""
    data = request.get_json()
    if 'image' not in data:
        return jsonify({'error': 'No se proporcionó una imagen válida'}), 400

    image_data = base64.b64decode(data['image'])
    image = Image.open(io.BytesIO(image_data))

    file_path = os.path.join(app.config['UPLOAD_FOLDER'], 'captured_image.png')
    image.save(file_path)

    return process_image(file_path)

@app.route('/edit-text', methods=['POST'])
def edit_text():
    """Actualiza el texto y recalcula los multiplicadores y predicción."""
    data = request.get_json()
    new_text = data.get('text', '')

    if not new_text:
        return jsonify({'error': 'El texto no puede estar vacío.'}), 400

    # Procesar el nuevo texto
    words = new_text.split()
    corrected_words = correct_multipliers_format(words)

    multipliers = []
    for word in corrected_words:
        try:
            if 'x' in word:
                value = float(word.replace('x', '').replace(',', '.'))
                multipliers.append(value)
        except ValueError:
            continue

    if multipliers:
        # Ajustar multiplicadores al rango 1-10
        adjusted_multipliers = preprocess_multipliers(multipliers)
        adjusted_scaled = scaler_y.fit_transform(np.array(adjusted_multipliers).reshape(-1, 1))
        input_data = adjusted_scaled.reshape(1, len(adjusted_scaled), 1)
        prediction_scaled = model7.predict(input_data)
        prediction = scaler_y.inverse_transform(prediction_scaled)

        # Actualizar resultados actuales
        global current_results
        current_results = {
            'text': new_text,
            'multipliers': multipliers,
            'prediction': float(prediction[0][0])
        }

        # Generar gráficos
        generate_graphs(multipliers, adjusted_multipliers, float(prediction[0][0]))

        return jsonify({
            'message': 'Texto y resultados actualizados correctamente.',
            'text': new_text,
            'multipliers': multipliers,
            'prediction': float(prediction[0][0])
        })
    else:
        return jsonify({'error': 'No se encontraron multiplicadores en el texto editado.'}), 400

def correct_multipliers_format(words):
    """Corrige el formato de los multiplicadores detectados."""
    corrected = []
    for word in words:
        word = word.replace(':', '.').replace(';', '.').replace(',', '.')
        if 'x' in word and '.' not in word and len(word) > 3:
            corrected_word = word[:-3] + '.' + word[-3:]
            corrected.append(corrected_word)
        else:
            corrected.append(word)
    return corrected

def preprocess_multipliers(multipliers):
    """Ajusta los valores de los multiplicadores al rango 1-10."""
    adjusted = [min(mult, 10) for mult in multipliers]
    print(f"Multiplicadores ajustados: {adjusted}")
    return adjusted

def process_image(file_path):
    """Procesa la imagen recortada directamente y aplica OCR."""
    image = cv2.imread(file_path)
    if image is None:
        return jsonify({'error': 'El archivo de imagen está vacío o es inválido'}), 400

    text = pytesseract.image_to_string(image, config='--psm 6')
    words = text.split()
    corrected_words = correct_multipliers_format(words)

    multipliers = []
    for word in corrected_words:
        try:
            if 'x' in word:
                value = float(word.replace('x', '').replace(',', '.'))
                multipliers.append(value)
        except ValueError:
            continue

    if multipliers:
        adjusted_multipliers = preprocess_multipliers(multipliers)
        adjusted_scaled = scaler_y.fit_transform(np.array(adjusted_multipliers).reshape(-1, 1))
        input_data = adjusted_scaled.reshape(1, len(adjusted_scaled), 1)
        prediction_scaled = model7.predict(input_data)
        prediction = scaler_y.inverse_transform(prediction_scaled)

        # Guardar resultados actuales
        global current_results
        current_results = {
            'text': text,
            'multipliers': multipliers,
            'prediction': float(prediction[0][0])
        }

        # Generar gráficos
        generate_graphs(multipliers, adjusted_multipliers, float(prediction[0][0]))

        return jsonify(current_results)
    else:
        return jsonify({'error': 'No se encontraron multiplicadores en la imagen'}), 400

def generate_graphs(multipliers, adjusted_multipliers, prediction):
    """Genera gráficos de los resultados."""
    # Gráfico Predicción vs Real
    plt.figure(figsize=(10, 5))
    plt.plot(range(len(adjusted_multipliers)), adjusted_multipliers, label='Valores Reales')
    plt.axhline(y=prediction, color='r', linestyle='--', label='Predicción')
    plt.title('Comparación de Valores Reales vs Predicción')
    plt.xlabel('Índice')
    plt.ylabel('Multiplicador')
    plt.legend()
    plt.savefig(os.path.join(GRAPH_FOLDER, 'prediction_vs_real.png'))
    plt.close()

    # Histograma de Multiplicadores
    plt.figure(figsize=(10, 5))
    plt.hist(multipliers, bins=10, color='blue', alpha=0.7)
    plt.title('Distribución de Multiplicadores')
    plt.xlabel('Multiplicador')
    plt.ylabel('Frecuencia')
    plt.savefig(os.path.join(GRAPH_FOLDER, 'multipliers_histogram.png'))
    plt.close()

    # Gráfico de Tendencia
    plt.figure(figsize=(10, 5))
    plt.plot(multipliers, label='Multiplicadores Originales')
    plt.title('Tendencia de Multiplicadores')
    plt.xlabel('Índice')
    plt.ylabel('Multiplicador')
    plt.legend()
    plt.savefig(os.path.join(GRAPH_FOLDER, 'multipliers_trend.png'))
    plt.close()

if __name__ == '__main__':
    app.run(debug=True)
