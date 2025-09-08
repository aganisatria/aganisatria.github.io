import * as duckdb from 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.28.0/+esm';

async function main() {
    const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
    const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);

    const worker_url = URL.createObjectURL(
        new Blob([`importScripts("${bundle.mainWorker}");`], {type: 'application/javascript'})
    );

    const worker = new Worker(worker_url);
    const logger = new duckdb.ConsoleLogger();
    const db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    URL.revokeObjectURL(worker_url);

    console.log("DuckDB-WASM module initialized successfully.");

    const fileInput = document.getElementById('parquet-file');
    const convertBtn = document.getElementById('convert-btn');
    const csvOutput = document.getElementById('csv-output');
    const downloadLink = document.getElementById('download-link');

    const connection = await db.connect();

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
                const fileName = file.name;

                // 2. Daftarkan file Parquet ke DuckDB
                // Ini seperti "mengunggah" file ke dalam memori database virtual
                await db.registerFileBuffer(fileName, uint8Array);

                // 3. Jalankan query SQL untuk membaca SEMUA data dari file Parquet
                const result = await connection.query(`SELECT * FROM "${fileName}";`);
                
                // 4. Konversi hasilnya menjadi array of objects (API yang sangat jelas!)
                const data = result.toArray().map(row => row.toJSON());

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
                downloadLink.download = fileName.replace(/\.parquet$/i, '.csv');

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

// Fungsi convertToCSV dan escapeCsvCell tidak berubah...
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

// Jalankan fungsi utama
main();