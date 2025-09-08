import * as duckdb from 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.28.0/+esm';

let UPLOADED_FILES = [];
let FULL_QUERY_RESULT = [];
let PAGINATION_STATE = {
    currentPage: 1,
    rowsPerPage: 50,
    totalPages: 1,
};

function renderSchema(schema, element) {
    element.textContent = schema.fields.map(f => `"${f.name}": ${String(f.type)}`).join('\n');
}

function renderTable(data, headerEl, bodyEl) {
    headerEl.innerHTML = '';
    bodyEl.innerHTML = '';
    if (data.length === 0) return;

    const headers = Object.keys(data[0]);
    const headerRow = document.createElement('tr');
    const thNum = document.createElement('th');
    thNum.textContent = '#';
    headerRow.appendChild(thNum);
    headers.forEach(h => {
        const th = document.createElement('th');
        th.textContent = h;
        headerRow.appendChild(th);
    });
    headerEl.appendChild(headerRow);

    const startRow = (PAGINATION_STATE.currentPage - 1) * PAGINATION_STATE.rowsPerPage;
    data.forEach((rowData, index) => {
        const tr = document.createElement('tr');
        const tdNum = document.createElement('td');
        tdNum.textContent = startRow + index + 1;
        tr.appendChild(tdNum);
        headers.forEach(header => {
            const td = document.createElement('td');
            td.textContent = rowData[header];
            tr.appendChild(td);
        });
        bodyEl.appendChild(tr);
    });
}

function renderFileList(listElement) {
    listElement.innerHTML = '';
    UPLOADED_FILES.forEach((fileData, index) => {
        const li = document.createElement('li');
        li.className = 'file-item';
        
        const textWrapper = document.createElement('div');
        const originalNameEl = document.createElement('div');
        originalNameEl.textContent = fileData.originalName;
        originalNameEl.style.fontWeight = 'bold';

        const aliasInput = document.createElement('input');
        aliasInput.type = 'text';
        aliasInput.placeholder = 'Enter alias...';
        aliasInput.value = fileData.alias;
        aliasInput.onchange = (e) => {
            fileData.alias = e.target.value.trim();
        };

        textWrapper.appendChild(originalNameEl);
        textWrapper.appendChild(aliasInput);

        const deleteBtn = document.createElement('button');
        deleteBtn.innerHTML = '&times;';
        deleteBtn.onclick = async () => {
            try {
                await dbInstance.dropFile(fileData.originalName);
                if (fileData.alias) {
                    await connInstance.query(`DROP VIEW IF EXISTS '${fileData.alias}';`);
                }
                UPLOADED_FILES.splice(index, 1);
                renderFileList(listElement, dbInstance, connInstance);
                console.log(`Removed ${fileData.originalName}`);
            } catch (err) {
                console.error(`Error removing file: ${err.message}`);
            }
        };
        
        li.appendChild(textWrapper);
        li.appendChild(deleteBtn);
        listElement.appendChild(li);
    });
}

async function main() {
    const ui = {
        fileInput: document.getElementById('parquet-file'),
        dropZone: document.getElementById('drop-zone'),
        fileList: document.getElementById('file-list'),
        queryInput: document.getElementById('query-input'),
        runQueryBtn: document.getElementById('run-query-btn'),
        resultsSection: document.getElementById('results-section'),
        schemaOutput: document.getElementById('schema-output'),
        tableHeader: document.getElementById('table-header'),
        tableBody: document.getElementById('table-body'),
        downloadLink: document.getElementById('download-link'),
        loader: document.getElementById('loader'),
        statusText: document.getElementById('status-text'),
        perfStats: document.getElementById('perf-stats'),
        prevPageBtn: document.getElementById('prev-page-btn'),
        nextPageBtn: document.getElementById('next-page-btn'),
        pageInfo: document.getElementById('page-info'),
        rowsPerPageSelect: document.getElementById('rows-per-page'),
    };

    const setStatus = (message, type = 'info') => {
        ui.statusText.textContent = message;
        ui.statusText.className = `status-${type}`;
    };

    const setLoading = (isLoading) => {
        ui.loader.style.display = isLoading ? 'block' : 'none';
        ui.runQueryBtn.disabled = isLoading;
    };

    setStatus('Initializing Engine...');
    const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
    const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);
    const worker_url = URL.createObjectURL(new Blob([`importScripts("${bundle.mainWorker}");`], {type: 'application/javascript'}));
    const worker = new Worker(worker_url);
    const logger = new duckdb.ConsoleLogger();
    const db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    URL.revokeObjectURL(worker_url);
    const connection = await db.connect();
    setStatus('Engine Ready.', 'success');

    const handleFiles = (files) => {
        for (const file of files) {
            if (file.name.endsWith('.parquet') && !UPLOADED_FILES.some(f => f.originalName === file.name)) {
                const reader = new FileReader();
                reader.onload = async (e) => {
                    try {
                        setStatus(`Registering ${file.name}...`);
                        const uint8Array = new Uint8Array(e.target.result);
                        await db.registerFileBuffer(file.name, uint8Array);
                        UPLOADED_FILES.push({
                            originalName: file.name,
                            alias: '',
                        });
                        renderFileList(ui.fileList, db, connection);
                        ui.runQueryBtn.disabled = false;
                        setStatus(`File ${file.name} ready.`, 'success');
                    } catch(err) {
                        setStatus(`Failed to register ${file.name}: ${err.message}`, 'error');
                        console.error(err);
                    }
                };
                reader.readAsArrayBuffer(file);
            }
        }
    };

    ui.dropZone.addEventListener('click', () => ui.fileInput.click());
    ui.fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eName => ui.dropZone.addEventListener(eName, e => { e.preventDefault(); e.stopPropagation(); }));
    ['dragenter', 'dragover'].forEach(eName => ui.dropZone.addEventListener(eName, () => ui.dropZone.classList.add('dragover')));
    ['dragleave', 'drop'].forEach(eName => ui.dropZone.addEventListener(eName, () => ui.dropZone.classList.remove('dragover')));
    ui.dropZone.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));

    const updateAndRenderPage = () => {
        PAGINATION_STATE.totalPages = Math.ceil(FULL_QUERY_RESULT.length / PAGINATION_STATE.rowsPerPage) || 1;
        ui.prevPageBtn.disabled = PAGINATION_STATE.currentPage === 1;
        ui.nextPageBtn.disabled = PAGINATION_STATE.currentPage === PAGINATION_STATE.totalPages;
        ui.pageInfo.textContent = `Page ${PAGINATION_STATE.currentPage} of ${PAGINATION_STATE.totalPages}`;
        
        const start = (PAGINATION_STATE.currentPage - 1) * PAGINATION_STATE.rowsPerPage;
        const end = start + PAGINATION_STATE.rowsPerPage;
        const pageData = FULL_QUERY_RESULT.slice(start, end);
        renderTable(pageData, ui.tableHeader, ui.tableBody);
    };

    ui.prevPageBtn.addEventListener('click', () => {
        if (PAGINATION_STATE.currentPage > 1) {
            PAGINATION_STATE.currentPage--;
            updateAndRenderPage();
        }
    });

    ui.nextPageBtn.addEventListener('click', () => {
        if (PAGINATION_STATE.currentPage < PAGINATION_STATE.totalPages) {
            PAGINATION_STATE.currentPage++;
            updateAndRenderPage();
        }
    });
    
    ui.rowsPerPageSelect.addEventListener('change', (e) => {
        PAGINATION_STATE.rowsPerPage = parseInt(e.target.value, 10);
        PAGINATION_STATE.currentPage = 1;
        updateAndRenderPage();
    });

    ui.runQueryBtn.addEventListener('click', async () => {
        setLoading(true);
        setStatus('Processing...');
        ui.resultsSection.style.display = 'none';

        try {
            for (const file of UPLOADED_FILES) {
                if (file.alias) {
                    await connection.query(`CREATE OR REPLACE VIEW '${file.alias}' AS SELECT * FROM '${file.originalName}';`);
                }
            }

            const query = ui.queryInput.value;
            const startTime = performance.now();
            const result = await connection.query(query);
            const endTime = performance.now();
            const duration = (endTime - startTime).toFixed(2);

            FULL_QUERY_RESULT = result.toArray().map(row => row.toJSON());
            
            ui.perfStats.textContent = `Query took: ${duration} ms | Rows returned: ${FULL_QUERY_RESULT.length}`;

            if (FULL_QUERY_RESULT.length === 0) {
                setStatus('Query returned no results.', 'info');
                ui.schemaOutput.textContent = 'No schema to display for empty result.';
                renderTable([], ui.tableHeader, ui.tableBody);
            } else {
                setStatus(`Success!`, 'success');
                renderSchema(result.schema, ui.schemaOutput);
                PAGINATION_STATE.currentPage = 1;
                updateAndRenderPage();
                
                const csvString = convertToCSV(FULL_QUERY_RESULT);
                const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
                ui.downloadLink.href = URL.createObjectURL(blob);
                ui.downloadLink.style.display = 'inline-block';
            }
            ui.resultsSection.style.display = 'block';

        } catch (err) {
            setStatus(err.message, 'error');
            console.error(err);
        } finally {
            setLoading(false);
        }
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