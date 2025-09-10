import * as duckdb from 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.28.0/+esm';

let VIRTUAL_TABLES = {}; // { tableName: [ { originalName: "f1.parquet", uniqueName: "uuid1.parquet" } ], ... }
let FULL_QUERY_RESULT = [];
let LAST_SUCCESSFUL_QUERY = '';
let PAGINATION_STATE = { currentPage: 1, rowsPerPage: 50, totalPages: 1 };

async function main() {
    const ui = {
        createTableBtn: document.getElementById('create-table-btn'),
        fileInput: document.getElementById('parquet-file'),
        virtualTablesContainer: document.getElementById('virtual-tables-container'),
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

    const setStatus = (message, type = 'info') => { ui.statusText.textContent = message; ui.statusText.className = `status-${type}`; };
    const setLoading = (isLoading, element) => {
        ui.loader.style.display = isLoading ? 'block' : 'none';
        if (element) element.disabled = isLoading;
    };

    setStatus('Initializing Engine...');
    const db = await initDuckDB();
    const connection = await db.connect();
    
    setStatus('Configuring environment...');
    await connection.query(`SET home_directory='/';`); 
    await connection.query(`INSTALL json;`);
    await connection.query(`LOAD json;`);
    
    setStatus('Engine Ready.', 'success');

    const renderWorkspace = () => {
        ui.virtualTablesContainer.innerHTML = '';
        Object.keys(VIRTUAL_TABLES).forEach(tableName => {
            const tableData = VIRTUAL_TABLES[tableName];
            const tableEl = createVirtualTableElement(tableName, tableData, db, connection, renderWorkspace, setStatus, ui.fileInput);
            ui.virtualTablesContainer.appendChild(tableEl);
        });
        const totalFiles = Object.values(VIRTUAL_TABLES).reduce((acc, files) => acc + files.length, 0);
        ui.runQueryBtn.disabled = totalFiles === 0;
    };
    
    ui.createTableBtn.addEventListener('click', () => {
        const tableName = prompt("Enter a name for the new virtual table (alphanumeric, no spaces):");
        if (tableName && /^[a-zA-Z0-9_]+$/.test(tableName)) {
            if (VIRTUAL_TABLES[tableName]) {
                alert(`Table "${tableName}" already exists.`);
                return;
            }
            VIRTUAL_TABLES[tableName] = [];
            renderWorkspace();
        } else if (tableName) {
            alert("Invalid name. Please use only letters, numbers, and underscores.");
        }
    });

    ui.fileInput.addEventListener('change', (e) => {
        const files = e.target.files;
        const tableName = ui.fileInput.dataset.tableName;
        if (files && tableName) {
            handleFiles(files, tableName, db, setStatus, renderWorkspace);
        }
    });

    ui.runQueryBtn.addEventListener('click', async () => {
        setLoading(true, ui.runQueryBtn);
        setStatus('Preparing tables and running query...');
        ui.resultsSection.style.display = 'none';
        ui.downloadSection.style.display = 'none';

        try {
            for (const tableName in VIRTUAL_TABLES) {
                const files = VIRTUAL_TABLES[tableName];
                if (files.length > 0) {
                    const unionQuery = files.map(f => `SELECT * FROM '${f.uniqueName}'`).join(' UNION ALL BY NAME ');
                    await connection.query(`CREATE OR REPLACE VIEW "${tableName}" AS ${unionQuery};`);
                } else {
                    await connection.query(`DROP VIEW IF EXISTS "${tableName}";`);
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
        await handleDownload(format, compression, LAST_SUCCESSFUL_QUERY, db, connection, setStatus, (isLoading) => setLoading(isLoading, button));
    });
    
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
}

async function initDuckDB() {
    const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
    const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);
    const worker_url = URL.createObjectURL(new Blob([`importScripts("${bundle.mainWorker}");`], {type: 'application/javascript'}));
    const worker = new Worker(worker_url);
    const logger = new duckdb.ConsoleLogger();
    const db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    URL.revokeObjectURL(worker_url);
    return db;
}

function handleFiles(files, tableName, db, setStatus, onComplete) {
    const filePromises = Array.from(files).map(file => {
        return new Promise((resolve, reject) => {
            if (file.name.endsWith('.parquet')) {
                const reader = new FileReader();
                reader.onload = async (e) => {
                    try {
                        const uint8Array = new Uint8Array(e.target.result);
                        const uniqueName = `file_${crypto.randomUUID()}.parquet`;
                        await db.registerFileBuffer(uniqueName, uint8Array);
                        VIRTUAL_TABLES[tableName].push({ originalName: file.name, uniqueName: uniqueName });
                        resolve();
                    } catch (err) { reject(err); }
                };
                reader.onerror = reject;
                reader.readAsArrayBuffer(file);
            } else {
                resolve();
            }
        });
    });

    Promise.all(filePromises)
        .then(() => {
            setStatus(`${files.length} file(s) processed for table ${tableName}.`, 'success');
            onComplete();
        })
        .catch(err => {
            setStatus(`Error processing files: ${err.message}`, 'error');
            console.error(err);
        });
}

function createVirtualTableElement(tableName, files, db, connection, renderWorkspace, setStatus, fileInputElement) {
    const tableDiv = document.createElement('div');
    tableDiv.className = 'virtual-table';
    const header = document.createElement('div');
    header.className = 'virtual-table-header';
    header.innerHTML = `<h5>${tableName}</h5><span>&#x25BC;</span>`;
    header.onclick = () => tableDiv.classList.toggle('open');
    const content = document.createElement('div');
    content.className = 'virtual-table-content';
    const fileList = document.createElement('ul');
    fileList.className = 'virtual-table-files';
    files.forEach((file, index) => {
        const li = document.createElement('li');
        li.textContent = file.originalName;
        const deleteBtn = document.createElement('button');
        deleteBtn.innerHTML = '&times;';
        deleteBtn.onclick = async (e) => {
            e.stopPropagation();
            await db.dropFile(file.uniqueName);
            VIRTUAL_TABLES[tableName].splice(index, 1);
            renderWorkspace();
            setStatus(`Removed ${file.originalName}`, 'info');
        };
        li.appendChild(deleteBtn);
        fileList.appendChild(li);
    });
    const addBtn = document.createElement('button');
    addBtn.className = 'add-file-btn';
    addBtn.textContent = '+ Add File(s)';
    addBtn.onclick = (e) => {
        e.stopPropagation();
        fileInputElement.dataset.tableName = tableName;
        fileInputElement.click();
    };
    content.appendChild(fileList);
    content.appendChild(addBtn);
    tableDiv.appendChild(header);
    tableDiv.appendChild(content);
    return tableDiv;
}

function renderTable(data, headerEl, bodyEl) {
    headerEl.innerHTML = ''; bodyEl.innerHTML = '';
    const headers = data.length > 0 ? Object.keys(data[0]) : (FULL_QUERY_RESULT.length > 0 ? Object.keys(FULL_QUERY_RESULT[0]) : []);
    const headerRow = document.createElement('tr');
    const thNum = document.createElement('th'); thNum.textContent = '#'; headerRow.appendChild(thNum);
    headers.forEach(h => { const th = document.createElement('th'); th.textContent = h; headerRow.appendChild(th); });
    headerEl.appendChild(headerRow);
    if (data.length === 0) {
        if(FULL_QUERY_RESULT.length >= 0) {
             const tr = document.createElement('tr'); const td = document.createElement('td');
             td.colSpan = headers.length + 1; 
             td.textContent = FULL_QUERY_RESULT.length > 0 ? 'No data on this page.' : 'Query returned no rows.';
             td.style.textAlign = 'center';
             tr.appendChild(td); bodyEl.appendChild(tr);
        }
        return;
    }
    const startRow = (PAGINATION_STATE.currentPage - 1) * PAGINATION_STATE.rowsPerPage;
    data.forEach((rowData, index) => {
        const tr = document.createElement('tr');
        const tdNum = document.createElement('td'); tdNum.textContent = startRow + index + 1; tr.appendChild(tdNum);
        headers.forEach(header => { const td = document.createElement('td'); td.textContent = rowData[header]; tr.appendChild(td); });
        bodyEl.appendChild(tr);
    });
}

function renderSchema(schema, element) { element.textContent = schema.fields.map(f => `"${f.name}": ${String(f.type)}`).join('\n'); }

async function handleDownload(format, compression, query, db, connection, setStatus, setLoading) {
    let sql = '';
    let filename = `query_result`;
    let mimeType = 'application/octet-stream';

    if (format === 'parquet') {
        const compressionName = compression !== 'none' ? `_${compression}` : '';
        filename += `${compressionName}.parquet`;
        const compressionSQL = compression !== 'none' ? `(COMPRESSION '${compression.toUpperCase()}')` : '';
        sql = `COPY (${query}) TO '${filename}' ${compressionSQL};`;
    } else if (format === 'csv') {
        mimeType = 'text/csv';
        filename += (compression === 'gzip') ? '.csv.gz' : '.csv';
        const compressionSQL = (compression === 'gzip') ? `, COMPRESSION 'gzip'` : '';
        sql = `COPY (${query}) TO '${filename}' (HEADER, DELIMITER ','${compressionSQL});`;
    } else if (format === 'json') {
        mimeType = 'application/json';
        filename += (compression === 'gzip') ? '.json.gz' : '.json';
        const compressionSQL = (compression === 'gzip') ? `, COMPRESSION 'gzip'` : '';
        sql = `COPY (${query}) TO '${filename}' (FORMAT 'JSON'${compressionSQL});`;
    } else { return; }

    setStatus(`Exporting to ${filename}...`);
    setLoading(true);
    try {
        try { await db.dropFile(filename); } catch (e) {}
        await connection.query(sql);
        const buffer = await db.copyFileToBuffer(filename);
        const blob = new Blob([buffer], { type: mimeType });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
        await db.dropFile(filename);
        setStatus('Export complete!', 'success');
    } catch(err) {
        setStatus(`Export failed: ${err.message}`, 'error');
        console.error(err);
    } finally {
        setLoading(false);
    }
}

main();