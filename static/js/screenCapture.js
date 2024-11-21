const uploadButton = document.getElementById('selectButton');
const fileInput = document.getElementById('fileInput');
const uploadForm = document.getElementById('uploadForm');
const captureButton = document.getElementById('captureButton');
const resultsDiv = document.getElementById('results');
const canvas = document.getElementById('captureCanvas');
const ctx = canvas.getContext('2d');

let startX, startY, endX, endY;
let isSelecting = false;
let originalImage = null;

uploadButton.addEventListener('click', () => {
    fileInput.click();
});

fileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) {
        clearCanvas(); // Limpiar cualquier captura previa

        const reader = new FileReader();
        reader.onload = (e) => {
            const imgPreview = document.createElement('img');
            imgPreview.src = e.target.result;
            imgPreview.alt = 'Vista previa de la imagen';
            imgPreview.style.maxWidth = '100%';
            imgPreview.style.maxHeight = '400px';
            imgPreview.style.border = '1px solid #ddd';
            imgPreview.style.borderRadius = '5px';
            imgPreview.style.padding = '5px';

            previewContainer.innerHTML = ''; // Limpiar la vista previa anterior
            previewContainer.appendChild(imgPreview); // Mostrar la nueva imagen
        };
        reader.readAsDataURL(file);
    } else {
        previewContainer.innerHTML = ''; // Limpiar si no hay archivo seleccionado
    }
});

uploadForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = fileInput.files[0];
    if (!file) {
        alert('Por favor, selecciona una imagen.');
        return;
    }

    const formData = new FormData();
    formData.append('image', file);

    const response = await fetch('/upload', {
        method: 'POST',
        body: formData,
    });

    const data = await response.json();
    displayResults(data);
});

captureButton.addEventListener('click', () => {
    //previewContainer.innerHTML = '';

    navigator.mediaDevices.getDisplayMedia({ video: true })
        .then(stream => {
            const videoElement = document.createElement('video');
            videoElement.srcObject = stream;

            videoElement.onloadedmetadata = () => {
                videoElement.play();
                canvas.width = videoElement.videoWidth;
                canvas.height = videoElement.videoHeight;

                ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
                originalImage = ctx.getImageData(0, 0, canvas.width, canvas.height);

                videoElement.pause();
                stream.getTracks().forEach(track => track.stop());
                canvas.classList.remove('hidden');
                enableSelection();
            };
        })
        .catch(error => console.error('Error al capturar la pantalla:', error));
});

function enableSelection() {
    canvas.addEventListener('mousedown', (e) => {
        isSelecting = true;
        startX = e.offsetX;
        startY = e.offsetY;
    });

    canvas.addEventListener('mousemove', (e) => {
        if (isSelecting) {
            endX = e.offsetX;
            endY = e.offsetY;
            redrawCanvas();
            drawSelection();
        }
    });

    canvas.addEventListener('mouseup', () => {
        isSelecting = false;
        const width = Math.abs(endX - startX);
        const height = Math.abs(endY - startY);
        const x = Math.min(startX, endX);
        const y = Math.min(startY, endY);

        const croppedCanvas = document.createElement('canvas');
        croppedCanvas.width = width;
        croppedCanvas.height = height;
        const croppedCtx = croppedCanvas.getContext('2d');
        croppedCtx.putImageData(
            ctx.getImageData(x, y, width, height), 0, 0
        );

        const croppedImage = croppedCanvas.toDataURL('image/png');
        sendCroppedImage(croppedImage);
    });
}

function redrawCanvas() {
    if (originalImage) {
        ctx.putImageData(originalImage, 0, 0); // Redibujar la imagen original
    }
}

function drawSelection() {
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 2;
    ctx.strokeRect(startX, startY, endX - startX, endY - startY);
}

async function sendCroppedImage(imageData) {
    const base64Image = imageData.split(',')[1];

    const response = await fetch('/predict-from-screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64Image }),
    });

    const data = await response.json();
    displayResults(data);
}

function displayResults(data) {
    if (data.prediction) {
        const prediction = data.prediction;
        const multipliers = data.multipliers;
        let recommendationText = "";

        // Inicialización de penalizaciones por rango
        let adjustedPrediction = prediction;
        let totalPenalty = 0;

        // Reglas para multiplicadores entre 2 y 3
        const between2And3 = multipliers.filter(m => m > 2 && m <= 3).length;
        if (between2And3 > 0) {
            totalPenalty += between2And3 * 0.15;
        }

        // Reglas para multiplicadores entre 3 y 4
        const between3And4 = multipliers.filter(m => m > 3 && m <= 4).length;
        if (between3And4 > 0) {
            totalPenalty += between3And4 * 0.2;
        }

        // Reglas para multiplicadores entre 4 y 5
        const between4And5 = multipliers.filter(m => m > 4 && m <= 5).length;
        if (between4And5 > 0) {
            totalPenalty += between4And5 * 0.3;
        }

        // Reglas para multiplicadores entre 5 y 6
        const between5And6 = multipliers.filter(m => m > 5 && m <= 6).length;
        if (between5And6 > 0) {
            totalPenalty += between5And6 * 0.4;
        }

        // Aplicar la penalización acumulada
        adjustedPrediction = Math.max(1, prediction - totalPenalty);

        // Generar texto de recomendación
        if (multipliers.filter(m => m >= 6).length > 1) {
            recommendationText = "Recomendamos que no apuestes, ya que hay más de un multiplicador mayor o igual a 6.";
        } else if (multipliers.some(m => m >= 7)) {
            const lowerBound = Math.max(1, prediction - 1.2);
            recommendationText = `Recomendamos que apuestes entre ${lowerBound.toFixed(2)} y ${prediction.toFixed(2)}.`;
        } else if (totalPenalty > 0.8) {
            const lowerBound = Math.max(1, adjustedPrediction);
            recommendationText = `Recomendamos que apuestes entre ${lowerBound.toFixed(2)} y ${prediction.toFixed(2)}.`;
        } else {
            const lowerBound = Math.max(1, prediction - 0.3);
            recommendationText = `Recomendamos que apuestes entre ${lowerBound.toFixed(2)} y ${prediction.toFixed(2)}.`;
        }

        // Renderizar resultados
        resultsDiv.innerHTML = `
            <h3>Resultados</h3>
            <div>
                <strong>Texto Detectado:</strong>
                <textarea id="editableText" class="editable-text">${data.text}</textarea>
                <button id="editTextButton" class="upload-button">Actualizar</button>
            </div>
            <p><strong>Multiplicadores Detectados:</strong> <span id="multipliersDetected">${data.multipliers.join(', ')}</span></p>
            <p><strong>Predicción:</strong> <span id="predictionValue">${data.prediction}</span></p>
            <div class="recommendation-box">
                <p><strong>Recomendación:</strong> ${recommendationText}</p>
            </div>
            <button id="showGraphsButton" class="upload-button">Mostrar Gráficos</button>
            <div id="graphsContainer" style="display: none; margin-top: 20px;">
                <h4>Gráficos:</h4>
                <img src="/graphs/prediction_vs_real.png?${new Date().getTime()}" alt="Gráfico Predicción vs Real" class="graph-img" />
                <img src="/graphs/multipliers_histogram.png?${new Date().getTime()}" alt="Histograma de Multiplicadores" class="graph-img" />
                <img src="/graphs/multipliers_trend.png?${new Date().getTime()}" alt="Tendencia de Multiplicadores" class="graph-img" />
            </div>
        `;

        // Botón para actualizar texto
        document.getElementById('editTextButton').addEventListener('click', () => {
            const newText = document.getElementById('editableText').value.trim();
            if (newText) {
                fetch('/edit-text', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: newText })
                })
                    .then(response => response.json())
                    .then(result => {
                        if (result.message) {
                            alert(result.message);

                            // Actualizar resultados en la interfaz
                            displayResults(result);
                        } else if (result.error) {
                            alert(result.error);
                        }
                    })
                    .catch(error => console.error('Error:', error));
            } else {
                alert('El texto no puede estar vacío.');
            }
        });

        // Botón para mostrar gráficos
        document.getElementById('showGraphsButton').addEventListener('click', () => {
            const graphsContainer = document.getElementById('graphsContainer');
            graphsContainer.style.display = 'block'; // Mostrar gráficos
        });
    } else {
        resultsDiv.innerHTML = `<p class="error-message">Error: ${data.error}</p>`;
    }
}

function clearCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    originalImage = null;
    canvas.classList.add('hidden');
    previewContainer.innerHTML = ''; // Limpiar vista previa
}

