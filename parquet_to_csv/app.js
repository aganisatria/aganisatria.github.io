import * as duckdb from 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.28.0/+esm';

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

function renderSchema(schema, element) {
    const fields = schema.fields;
    const schemaText = fields.map(field => `"${field.name}": ${String(field.type)}`).join('\n');
    element.textContent = schemaText;
}

function renderTable(data, headerElement, bodyElement, limit = 50) {
    headerElement.innerHTML = '';
    bodyElement.innerHTML = '';

    if (data.length === 0) return;

    const headers = Object.keys(data[0]);
    const headerRow = document.createElement('tr');
    headers.forEach(headerText => {
        const th = document.createElement('th');
        th.textContent = headerText;
        headerRow.appendChild(th);
    });
    headerElement.appendChild(headerRow);

    const previewData = data.slice(0, limit);
    previewData.forEach(rowData => {
        const row = document.createElement('tr');
        headers.forEach(header => {
            const td = document.createElement('td');
            td.textContent = rowData[header];
            row.appendChild(td);
        });
        bodyElement.appendChild(row);
    });
}


async function main() {
    const fileInput = document.getElementById('parquet-file');
    const dropZone = document.getElementById('drop-zone');
    const fileNameDisplay = document.getElementById('file-name-display');
    const querySection = document.getElementById('query-section');
    const queryInput = document.getElementById('query-input');
    const runQueryBtn = document.getElementById('run-query-btn');
    const resultsSection = document.getElementById('results-section');
    const schemaOutput = document.getElementById('schema-output');
    const tableHeader = document.getElementById('table-header');
    const tableBody = document.getElementById('table-body');
    const downloadLink = document.getElementById('download-link');
    const loader = document.getElementById('loader');
    const statusText = document.getElementById('status-text');
    
    let selectedFile = null;

    const setStatus = (message, type = 'info') => {
        statusText.textContent = message;
        statusText.className = `status-${type}`;
    };
    const setLoading = (isLoading) => {
        loader.style.display = isLoading ? 'block' : 'none';
        runQueryBtn.disabled = isLoading;
        fileInput.disabled = isLoading;
    };

    setStatus('Initializing Database Engine...');
    setLoading(true);
    
    const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
    const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);
    const worker_url = URL.createObjectURL(
        new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'application/javascript' })
    );
    const worker = new Worker(worker_url);
    const logger = new duckdb.ConsoleLogger();
    const db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    URL.revokeObjectURL(worker_url);
    const connection = await db.connect();

    setStatus('Engine Ready. Please select a file.', 'success');
    setLoading(false);

    const handleFile = (file) => {
        if (!file || !file.name.endsWith('.parquet')) {
            setStatus('Please select a valid .parquet file.', 'error');
            return;
        }
        selectedFile = file;
        fileNameDisplay.textContent = `Selected: ${file.name}`;
        queryInput.value = `SELECT * FROM '${file.name}';`;
        querySection.style.display = 'block';
        runQueryBtn.disabled = false;
        resultsSection.style.display = 'none';
        setStatus('File selected. You can now run the query.');
    };

    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));
    
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eName => dropZone.addEventListener(eName, e => { e.preventDefault(); e.stopPropagation(); }));
    ['dragenter', 'dragover'].forEach(eName => dropZone.addEventListener(eName, () => dropZone.classList.add('dragover')));
    ['dragleave', 'drop'].forEach(eName => dropZone.addEventListener(eName, () => dropZone.classList.remove('dragover')));
    dropZone.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));

    runQueryBtn.addEventListener('click', async () => {
        if (!selectedFile) {
            setStatus('No file selected.', 'error');
            return;
        }

        setLoading(true);
        setStatus('Processing...');
        resultsSection.style.display = 'none';
        downloadLink.style.display = 'none';

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const uint8Array = new Uint8Array(event.target.result);
                const query = queryInput.value;

                await db.registerFileBuffer(selectedFile.name, uint8Array);
                const result = await connection.query(query);
                const data = result.toArray().map(row => row.toJSON());

                if (data.length === 0) {
                    setStatus('Query returned no results.', 'info');
                    resultsSection.style.display = 'block';
                    renderSchema(result.schema, schemaOutput);
                    renderTable([], tableHeader, tableBody);
                    setLoading(false);
                    return;
                }
                
                renderSchema(result.schema, schemaOutput);
                renderTable(data, tableHeader, tableBody, 50);

                const csvString = convertToCSV(data);
                const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                downloadLink.href = url;
                downloadLink.style.display = 'block';
                
                setStatus(`Success! Showing preview of ${Math.min(data.length, 50)} of ${data.length} total rows.`, 'success');
                resultsSection.style.display = 'block';

            } catch (err) {
                setStatus(err.message, 'error');
                console.error(err);
            } finally {
                setLoading(false);
            }
        };
        reader.onerror = () => {
            setStatus('Failed to read the file.', 'error');
            setLoading(false);
        };
        reader.readAsArrayBuffer(selectedFile);
    });
}

main();