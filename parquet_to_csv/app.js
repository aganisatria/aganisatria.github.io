// Buat fungsi utama yang async
async function main() {
    await parquet_wasm.init();

    const fileInput = document.getElementById('parquet-file');
    const convertBtn = document.getElementById('convert-btn');
    const csvOutput = document.getElementById('csv-output');
    const downloadLink = document.getElementById('download-link');

    convertBtn.addEventListener('click', () => {
        // PENANDA 1: Untuk memeriksa apakah klik terdeteksi
        console.log("Tombol 'Convert' diklik!");

        const file = fileInput.files[0];
        
        // PENANDA 2: Untuk memeriksa apakah file berhasil diambil
        console.log("File yang dipilih:", file);

        if (!file) {
            alert("Please select a Parquet file first!");
            return;
        }
        
        // PENANDA 3: Untuk memeriksa sebelum file mulai dibaca
        console.log("FileReader akan mulai membaca file...");

        const reader = new FileReader();

        reader.onload = async function(event) {
            csvOutput.textContent = "Processing...";
            downloadLink.style.display = 'none';
            try {
                const arrayBuffer = event.target.result;
                const uint8Array = new Uint8Array(arrayBuffer);
                const arrowTable = parquet_wasm.readParquet(uint8Array);
                const data = arrowTable.toArray().map(row => row.toJSON());

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


// Jalankan fungsi utama
main();
