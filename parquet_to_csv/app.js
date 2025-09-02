// Langkah 1: Import library parquet-wasm sebagai ES Module
// URL ini diambil dari temuan Anda, yang merupakan cara yang benar.
import parquet_wasm from 'https://cdn.jsdelivr.net/npm/parquet-wasm@0.6.1/+esm';

// Buat fungsi utama yang async untuk menggunakan 'await'
async function main() {
    // Inisialisasi library (diperlukan untuk me-load file .wasm pendukungnya)
    await parquet_wasm.init();

    // Ambil elemen-elemen dari halaman HTML
    const fileInput = document.getElementById('parquet-file');
    const convertBtn = document.getElementById('convert-btn');
    const csvOutput = document.getElementById('csv-output');
    const downloadLink = document.getElementById('download-link');

    // Tambahkan event listener untuk tombol 'convert'
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
                
                // Gunakan library untuk membaca file Parquet
                const arrowTable = parquet_wasm.readParquet(uint8Array);
                const data = arrowTable.toArray().map(row => row.toJSON());

                if (data.length === 0) {
                    csvOutput.textContent = "Parquet file is empty or could not be read.";
                    return;
                }

                // Ubah data menjadi string CSV
                const csvString = convertToCSV(data);
                csvOutput.textContent = csvString;

                // Siapkan link untuk mengunduh file CSV
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

// Fungsi untuk mengubah array of objects menjadi string CSV
function convertToCSV(objArray) {
    if (objArray.length === 0) return "";
    const headers = Object.keys(objArray[0]);
    const headerRow = headers.map(escapeCsvCell).join(',');
    const rows = objArray.map(obj => headers.map(header => escapeCsvCell(obj[header])).join(','));
    return [headerRow, ...rows].join('\n');
}

// Fungsi untuk menangani karakter khusus dalam sel CSV (koma, kutip)
function escapeCsvCell(cell) {
    if (cell == null) return '';
    let cellString = String(cell);
    if (cellString.includes(',') || cellString.includes('"') || cellString.includes('\n')) {
        cellString = cellString.replace(/"/g, '""');
        return `"${cellString}"`;
    }
    return cellString;
}

// Jalankan fungsi utama kita
main();
