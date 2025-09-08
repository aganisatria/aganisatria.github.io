import * as duckdb from 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.28.0/+esm';

let UPLOADED_FILES = [];
let FULL_QUERY_RESULT = [];
let LAST_SUCCESSFUL_QUERY = '';
let PAGINATION_STATE = { currentPage: 1, rowsPerPage: 50, totalPages: 1 };

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
        downloadSection: document.getElementById('download-section'),
        downloadOptions: document.getElementById('download-options'),
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
    const setLoading = (isLoading, element = ui.runQueryBtn) => {
        ui.loader.style.display = isLoading ? 'block' : 'none';
        element.disabled = isLoading;
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
                        setLoading(true, ui.runQueryBtn);
                        const uint8Array = new Uint8Array(e.target.result);
                        await db.registerFileBuffer(file.name, uint8Array);
                        
                        UPLOADED_FILES.push({ originalName: file.name, alias: '' });
                        renderFileList(ui.fileList, db, connection, setStatus);
                        ui.runQueryBtn.disabled = false;
                        setStatus(`File ${file.name} ready.`, 'success');
                    } catch(err) {
                        setStatus(`Failed to register ${file.name}: ${err.message}`, 'error');
                        console.error(err);
                    } finally {
                        setLoading(false, ui.runQueryBtn);
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
        const { currentPage, rowsPerPage } = PAGINATION_STATE;
        PAGINATION_STATE.totalPages = Math.ceil(FULL_QUERY_RESULT.length / rowsPerPage) || 1;
        ui.prevPageBtn.disabled = currentPage === 1;
        ui.nextPageBtn.disabled = currentPage === PAGINATION_STATE.totalPages;
        ui.pageInfo.textContent = `Page ${currentPage} of ${PAGINATION_STATE.totalPages}`;
        
        const start = (currentPage - 1) * rowsPerPage;
        const end = start + rowsPerPage;
        const pageData = FULL_QUERY_RESULT.slice(start, end);
        renderTable(pageData, ui.tableHeader, ui.tableBody);
    };

    ui.prevPageBtn.addEventListener('click', () => { if (PAGINATION_STATE.currentPage > 1) { PAGINATION_STATE.currentPage--; updateAndRenderPage(); } });
    ui.nextPageBtn.addEventListener('click', () => { if (PAGINATION_STATE.currentPage < PAGINATION_STATE.totalPages) { PAGINATION_STATE.currentPage++; updateAndRenderPage(); } });
    ui.rowsPerPageSelect.addEventListener('change', (e) => { PAGINATION_STATE.rowsPerPage = parseInt(e.target.value, 10); PAGINATION_STATE.currentPage = 1; updateAndRenderPage(); });

    ui.runQueryBtn.addEventListener('click', async () => {
        setLoading(true, ui.runQueryBtn);
        setStatus('Running query...');
        ui.resultsSection.style.display = 'none';
        ui.downloadSection.style.display = 'none';

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
            
            LAST_SUCCESSFUL_QUERY = query;
            FULL_QUERY_RESULT = result.toArray().map(row => row.toJSON());
            
            ui.perfStats.textContent = `Query took: ${duration} ms | Rows returned: ${FULL_QUERY_RESULT.length}`;
            
            renderSchema(result.schema, ui.schemaOutput);
            if (FULL_QUERY_RESULT.length > 0) {
                PAGINATION_STATE.currentPage = 1;
                updateAndRenderPage();
                ui.downloadSection.style.display = 'block';
                setStatus(`Success!`, 'success');
            } else {
                setStatus('Query returned no results.', 'info');
                renderTable([], ui.tableHeader, ui.tableBody);
            }
            ui.resultsSection.style.display = 'block';

        } catch (err) {
            setStatus(err.message, 'error');
            console.error(err);
        } finally {
            setLoading(false, ui.runQueryBtn);
        }
    });

    ui.downloadOptions.addEventListener('click', async (e) => {
        if (e.target.tagName !== 'BUTTON' || !LAST_SUCCESSFUL_QUERY) return;

        const button = e.target;
        const format = button.dataset.format;
        const compressionSelect = document.getElementById(`${format}-compression`);
        const compression = compressionSelect ? compressionSelect.value : 'none';

        let sql = '';
        let filename = `query_result`;
        let mimeType = 'application/octet-stream';

        if (format === 'parquet') {
            filename += `.parquet`;
            const compressionSQL = compression !== 'none' ? `(COMPRESSION '${compression.toUpperCase()}')` : '';
            sql = `COPY (${LAST_SUCCESSFUL_QUERY}) TO '${filename}' ${compressionSQL};`;
        } else if (format === 'csv') {
            mimeType = 'text/csv';
            filename += (compression === 'gzip') ? '.csv.gz' : '.csv';
            const compressionSQL = (compression === 'gzip') ? ", COMPRESSION 'gzip'" : '';
            sql = `COPY (${LAST_SUCCESSFUL_QUERY}) TO '${filename}' (HEADER, DELIMITER ','${compressionSQL});`;
        } else if (format === 'json') {
            mimeType = 'application/json';
            filename += (compression === 'gzip') ? '.json.gz' : '.json';
            const compressionSQL = (compression === 'gzip') ? `(COMPRESSION 'gzip')` : '';
            sql = `COPY (${LAST_SUCCESSFUL_QUERY}) TO '${filename}' ${compressionSQL};`;
        } else { return; }

        setStatus(`Exporting to ${filename}...`);
        setLoading(true, button);
        
        try {
            await connection.query(`DROP TABLE IF EXISTS export_temp_table;`);
            await connection.query(`CREATE TEMP TABLE export_temp_table AS ${LAST_SUCCESSFUL_QUERY};`);
            await db.copyFileToBuffer(filename);
            await connection.query(`COPY (SELECT * FROM export_temp_table) TO '${filename}'`);
            
            const buffer = await db.copyFileToBuffer(filename);
            const blob = new Blob([buffer], { type: mimeType });
            
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
            
            setStatus('Export complete!', 'success');
        } catch(err) {
            setStatus(`Export failed: ${err.message}`, 'error');
            console.error(err);
        } finally {
            setLoading(false, button);
        }
    });
}

function renderFileList(listElement, dbInstance, connInstance, setStatus) {
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
        aliasInput.onchange = (e) => { fileData.alias = e.target.value.trim(); };
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
                renderFileList(listElement, dbInstance, connInstance, setStatus);
                setStatus(`Removed ${fileData.originalName}`, 'info');
            } catch (err) {
                setStatus(`Error removing file: ${err.message}`, 'error');
                console.error(err);
            }
        };
        li.appendChild(textWrapper);
        li.appendChild(deleteBtn);
        listElement.appendChild(li);
    });
}

function renderTable(data, headerEl, bodyEl) {
    headerEl.innerHTML = ''; 
    bodyEl.innerHTML = '';
    const headers = data.length > 0 ? Object.keys(data[0]) : (FULL_QUERY_RESULT.length > 0 ? Object.keys(FULL_QUERY_RESULT[0]) : []);
    const headerRow = document.createElement('tr');
    const thNum = document.createElement('th');
    thNum.textContent = '#';
    headerRow.appendChild(thNum);
    headers.forEach(h => { const th = document.createElement('th'); th.textContent = h; headerRow.appendChild(th); });
    headerEl.appendChild(headerRow);
    if (data.length === 0) {
        if(FULL_QUERY_RESULT.length > 0) {
             const tr = document.createElement('tr');
             const td = document.createElement('td');
             td.colSpan = headers.length + 1;
             td.textContent = 'No data on this page.';
             td.style.textAlign = 'center';
             tr.appendChild(td);
             bodyEl.appendChild(tr);
        }
        return;
    }
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

function renderSchema(schema, element) { 
    element.textContent = schema.fields.map(f => `"${f.name}": ${String(f.type)}`).join('\n'); 
}

main();