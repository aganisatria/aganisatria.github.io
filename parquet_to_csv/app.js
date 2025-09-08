import init, { readParquet } from 'https://cdn.jsdelivr.net/npm/parquet-wasm@0.6.1/+esm';

async function main() {
    const wasmUrl = 'https://cdn.jsdelivr.net/npm/parquet-wasm@0.6.1/esm/parquet_wasm_bg.wasm';
    await init(wasmUrl);

    console.log("Parquet-WASM module initialized successfully.");

    const fileInput = document.getElementById('parquet-file');
    const convertBtn = document.getElementById('convert-btn');
    const csvOutput = document.getElementById('csv-output');
    const downloadLink = document.getElementById('download-link');

    convertBtn.addEventListener('click', () => {
        const file = fileInput.files[0];
        if (!file) {
            alert("Please select a Parquet file first!");
            return;
        }

        const reader = new FileReader();

        reader.onload = async function(event) {
            csvOutput.textContent = "Processing...";
            downloadLink.style.display = 'none';
            try {
                const arrayBuffer = event.target.result;
                const uint8Array = new Uint8Array(arrayBuffer);
                
                const arrowTable = readParquet(uint8Array);
                const data = [];
                const numRows = arrowTable.numRows;
                for (let i = 0; i < numRows; i++) {
                    data.push(arrowTable.get(i).toJSON());
                }

                if (data.length === 0) {
                    csvOutput.textContent = "Parquet file is empty or could not be read.";
                    return;
                }

                const csvString = convertToCSV(data);
                csvOutput.textContent = csvString;

                const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                
                downloadLink.href = url;
                downloadLink.style.display = 'inline-block';
                downloadLink.download = file.name.replace(/\.parquet$/i, '.csv');

            } catch (error) {
                console.error("Error processing Parquet file:", error);
                csvOutput.textContent = `Error: ${error.message}`;
            }
        };

        reader.onerror = function() {
            csvOutput.textContent = "Error: Failed to read the file.";
            console.error("FileReader error:", reader.error);
        };

        reader.readAsArrayBuffer(file);
    });
}

function convertToCSV(objArray) {
    if (objArray.length === 0) return "";
    const headers = Object.keys(objArray[0]);
    const headerRow = headers.map(escapeCsvCell).join(',');
    const rows = objArray.map(obj => headers.map(header => escapeCsvCell(obj[header])).join(','));
    return [headerRow, ...rows].join('\n');
}

function escapeCsvCell(cell) {
    if (cell == null) return '';
    let cellString = String(cell);
    if (cellString.includes(',') || cellString.includes('"') || cellString.includes('\n')) {
        cellString = cellString.replace(/"/g, '""');
        return `"${cellString}"`;
    }
    return cellString;
}

main();