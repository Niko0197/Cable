document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('calc-form');
    const seriesSelect = document.getElementById('series');
    const customParamsDiv = document.getElementById('custom-params');
    const tabs = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    // Тема
    const toggleSwitch = document.querySelector('.theme-switch input[type="checkbox"]');
    const currentTheme = localStorage.getItem('theme');

    if (currentTheme) {
        document.documentElement.setAttribute('data-theme', currentTheme);
        if (currentTheme === 'dark') {
            toggleSwitch.checked = true;
        }
    }

    function switchTheme(e) {
        if (e.target.checked) {
            document.documentElement.setAttribute('data-theme', 'dark');
            localStorage.setItem('theme', 'dark');
        } else {
            document.documentElement.setAttribute('data-theme', 'light');
            localStorage.setItem('theme', 'light');
        }
        // Перерисовываем канвас при смене темы
        if (window.lastCalculationData) {
            drawBuildingCanvas(window.lastCalculationData);
        }
    }

    toggleSwitch.addEventListener('change', switchTheme, false);

    const seriesEntrances = {
        'pik': 1,
        'p44': 4,
        'i155': 1,
        'brezhnevka': 4,
        'khrushchev': 4,
        'stalin': 3
    };

    const seriesFloors = {
        'pik': 25,
        'p44': 17,
        'i155': 24,
        'brezhnevka': 9,
        'khrushchev': 5,
        'stalin': 5
    };

    // Переключение пользовательских параметров и автоподстановка
    seriesSelect.addEventListener('change', (e) => {
        const selectedSeries = e.target.value;
        
        // Автоподстановка для выбранной серии
        if (seriesEntrances[selectedSeries]) {
            document.getElementById('entrances').value = seriesEntrances[selectedSeries];
        }
        if (seriesFloors[selectedSeries]) {
            document.getElementById('floors').value = seriesFloors[selectedSeries];
        }

        if (selectedSeries === 'custom') {
            customParamsDiv.classList.remove('hidden');
        } else {
            customParamsDiv.classList.add('hidden');
        }
    });

    // Переключение вкладок
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            
            tab.classList.add('active');
            document.getElementById(tab.dataset.tab).classList.add('active');
        });
    });

    // Обработка формы
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const formData = new FormData(form);
        const series = formData.get('series');
        
        const payload = {
            series: series,
            technology: formData.get('technology'),
            distanceAts: formData.get('distanceAts'),
            entrances: parseInt(formData.get('entrances'), 10) || 1,
            floors: parseInt(formData.get('floors'), 10) || 1,
            entryPoint: formData.get('entryPoint')
        };

        if (series === 'custom') {
            payload.customParams = {
                aptsPerFloor: parseInt(formData.get('aptsPerFloor')),
                floorHeight: parseFloat(formData.get('floorHeight')),
                corridorLength: parseFloat(formData.get('corridorLength')),
                routingType: formData.get('routingType')
            };
        }

        try {
            const response = await fetch('/calculate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json();
            if (response.ok) {
                window.lastCalculationData = data;
                // Сброс зума при новом расчете
                zoom = 1;
                offset = { x: 0, y: 0 };
                updateUI(data);
                drawBuildingCanvas(data);
            } else {
                alert('Ошибка: ' + data.error);
            }
        } catch (err) {
            console.error(err);
            alert('Ошибка соединения с сервером.');
        }
    });

    // Обновление DOM результатов
    function updateUI(data) {
        document.getElementById('res-total-subs').textContent = data.building.totalSubscribers;
        document.getElementById('res-tech').textContent = data.technology;

        const ftthCard = document.getElementById('ftth-card');
        if (data.technology === 'FTTH' && data.ftthDetails) {
            ftthCard.style.display = 'block';
            document.getElementById('res-topology').textContent = data.ftthDetails.splitters.topology;
            document.getElementById('res-l1-splitters').textContent = 
                `1x${data.ftthDetails.splitters.l1Ratio} - ${data.ftthDetails.splitters.counts[data.ftthDetails.splitters.l1Ratio]} шт.`;
            document.getElementById('res-l2-splitters').textContent = 
                `1x${data.ftthDetails.splitters.l2Ratio} - ${data.ftthDetails.splitters.counts[data.ftthDetails.splitters.l2Ratio]} шт.`;
            document.getElementById('res-budget').textContent = `${data.ftthDetails.opticalBudgetDb} дБ`;
        } else {
            ftthCard.style.display = 'none';
        }

        // Чистая смета
        document.getElementById('est-pure-trunk').value = data.estimates.pure.trunk;
        document.getElementById('est-pure-dist').value = data.estimates.pure.distribution;
        document.getElementById('est-pure-horiz').value = data.estimates.pure.horizontal;
        
        // Смета с запасом
        document.getElementById('est-res-trunk').value = data.estimates.withReserve.trunk;
        document.getElementById('est-res-dist').value = data.estimates.withReserve.distribution;
        document.getElementById('est-res-horiz').value = data.estimates.withReserve.horizontal;

        recalculateEstimateTotals();

        // Финансы
        if (data.finance) {
            renderFinanceTable(data.finance.items);
        }
    }

    function renderFinanceTable(items) {
        const tbody = document.getElementById('finance-tbody');
        tbody.innerHTML = '';
        items.forEach((item, index) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${item.name}</td>
                <td><input type="number" class="finance-input edit-qty" data-index="${index}" value="${item.qty}"></td>
                <td>${item.unit}</td>
                <td><input type="number" class="finance-input edit-price" data-index="${index}" value="${item.price}"></td>
                <td style="font-weight: bold;" class="item-total">${item.total.toLocaleString('ru-RU')}</td>
            `;
            tbody.appendChild(tr);
        });
        updateFinanceTotals();
    }

    // Слушатели для ручного редактирования сметы
    const resInputs = document.querySelectorAll('.res-input');
    resInputs.forEach(input => {
        input.addEventListener('input', () => {
            if (input.value === '' && window.lastCalculationData) {
                // Восстанавливаем из исходных данных если пусто
                const id = input.id;
                const path = id.startsWith('est-pure') ? 'pure' : 'withReserve';
                const field = id.split('-').pop();
                const keyMap = { trunk: 'trunk', dist: 'distribution', horiz: 'horizontal' };
                input.value = window.lastCalculationData.estimates[path][keyMap[field]];
            }
            recalculateEstimateTotals();
        });
    });

    function recalculateEstimateTotals() {
        const pureTotal = 
            parseFloat(document.getElementById('est-pure-trunk').value || 0) +
            parseFloat(document.getElementById('est-pure-dist').value || 0) +
            parseFloat(document.getElementById('est-pure-horiz').value || 0);
        
        const resTotal = 
            parseFloat(document.getElementById('est-res-trunk').value || 0) +
            parseFloat(document.getElementById('est-res-dist').value || 0) +
            parseFloat(document.getElementById('est-res-horiz').value || 0);

        document.getElementById('est-pure-total').textContent = Math.round(pureTotal * 10) / 10 + ' м';
        document.getElementById('est-res-total').textContent = Math.round(resTotal * 10) / 10 + ' м';
    }

    // Слушатели для таблицы финансов
    document.getElementById('finance-tbody').addEventListener('input', (e) => {
        if (e.target.classList.contains('edit-qty') || e.target.classList.contains('edit-price')) {
            const tr = e.target.closest('tr');
            const qty = parseFloat(tr.querySelector('.edit-qty').value || 0);
            const price = parseFloat(tr.querySelector('.edit-price').value || 0);
            const totalCell = tr.querySelector('.item-total');
            
            const total = qty * price;
            totalCell.textContent = total.toLocaleString('ru-RU');
            
            updateFinanceTotals();
        }
    });

    function updateFinanceTotals() {
        let totalSum = 0;
        document.querySelectorAll('.item-total').forEach(cell => {
            const val = parseFloat(cell.textContent.replace(/\s/g, '').replace(',', '.')) || 0;
            totalSum += val;
        });

        document.getElementById('res-total-cost').textContent = totalSum.toLocaleString('ru-RU') + ' ₽';
        
        const totalSubs = parseInt(document.getElementById('res-total-subs').textContent) || 1;
        const costPerSub = Math.round(totalSum / totalSubs);
        document.getElementById('res-cost-per-sub').textContent = costPerSub.toLocaleString('ru-RU') + ' ₽';
    }

    // Визуализация на Canvas (Zoom & Pan)
    let zoom = 1;
    let offset = { x: 0, y: 0 };
    let isDragging = false;
    let dragStart = { x: 0, y: 0 };

    const canvas = document.getElementById('buildingCanvas');
    const canvasWrapper = canvas.parentElement;

    canvasWrapper.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.min(Math.max(0.5, zoom * delta), 5);
        
        // Масштабирование относительно курсора
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        offset.x -= mouseX * (newZoom / zoom - 1);
        offset.y -= mouseY * (newZoom / zoom - 1);
        
        zoom = newZoom;
        if (window.lastCalculationData) drawBuildingCanvas(window.lastCalculationData);
    });

    canvasWrapper.addEventListener('mousedown', (e) => {
        isDragging = true;
        dragStart = { x: e.clientX - offset.x, y: e.clientY - offset.y };
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        offset.x = e.clientX - dragStart.x;
        offset.y = e.clientY - dragStart.y;
        if (window.lastCalculationData) drawBuildingCanvas(window.lastCalculationData);
    });

    window.addEventListener('mouseup', () => {
        isDragging = false;
    });

    function drawBuildingCanvas(data) {
        const canvas = document.getElementById('buildingCanvas');
        const ctx = canvas.getContext('2d');
        const { floors, entrances, routingType, aptsPerFloor, name, entryPoint } = data.building;
        const tech = data.technology;
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

        // Очистка
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Применяем Zoom и Offset
        ctx.translate(offset.x, offset.y);
        ctx.scale(zoom, zoom);

        // Цвета линий для FTTB
        const colors = {
            okr: '#ef4444',      // Красный (Оптика до здания)
            rsh: '#8b5cf6',      // Фиолетовый (Шкаф - переход на медь)
            copper: '#3b82f6',   // Синий (Медный стояк/магистраль по дому)
            horiz: '#10b981',    // Зеленый (Разводка до абонента)
            kr: '#f97316',       // Оранжевый (Коробка КР)
            kru: '#64748b',      // Серый (Коробка КРУ)
            building: isDark ? '#475569' : '#cbd5e1', 
            textMain: isDark ? '#f8fafc' : '#1e293b',
            textMuted: isDark ? '#94a3b8' : '#64748b'
        };

        const marginX = 120;
        const marginY = 50;
        const bWidth = 600;
        const bHeight = 450;
        
        const entWidth = bWidth / entrances;
        const totalLevels = floors + 2;
        const floorHeightPx = bHeight / totalLevels;

        // Отрисовка подзаголовка "Серия здания"
        ctx.fillStyle = colors.textMuted;
        ctx.font = '10px Arial';
        ctx.textAlign = 'left';
        ctx.fillText('Серия здания:', marginX, marginY - 35);

        // Отрисовка основного заголовка
        ctx.fillStyle = colors.textMain;
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'left';
        const buildingName = name || 'Пользовательский проект';
        ctx.fillText(`${buildingName}: ${entrances} под., ${floors} эт.`, marginX, marginY - 18);

        // 1. Отрисовка контура здания
        ctx.strokeStyle = colors.building;
        ctx.lineWidth = 2;
        ctx.strokeRect(marginX, marginY, bWidth, bHeight);
        
        ctx.beginPath();
        for (let i = 1; i < totalLevels; i++) {
            ctx.moveTo(marginX, marginY + i * floorHeightPx);
            ctx.lineTo(marginX + bWidth, marginY + i * floorHeightPx);
        }
        ctx.stroke();

        ctx.beginPath();
        for (let i = 1; i < entrances; i++) {
            ctx.moveTo(marginX + i * entWidth, marginY + floorHeightPx);
            ctx.lineTo(marginX + i * entWidth, marginY + bHeight - floorHeightPx);
        }
        ctx.stroke();

        // Подписи этажей
        ctx.fillStyle = colors.textMain;
        ctx.font = '12px Arial';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (let r = 0; r < totalLevels; r++) {
            const yCenter = marginY + r * floorHeightPx + floorHeightPx / 2;
            let text = r === 0 ? 'Чердак' : (r === totalLevels - 1 ? 'Подвал' : `Этаж ${floors - r + 1}`);
            ctx.fillText(text, marginX - 10, yCenter);
        }

        const basementY = marginY + bHeight - floorHeightPx / 2;
        const atticY = marginY + floorHeightPx / 2;
        const entryY = entryPoint === 'attic' ? atticY : basementY;
        const rshX = marginX + 35;

        // 2. ОКР и РШ
        ctx.beginPath();
        ctx.strokeStyle = colors.okr;
        ctx.lineWidth = 3;
        ctx.moveTo(10, entryY);
        ctx.lineTo(marginX + 25, entryY);
        ctx.stroke();
        
        ctx.fillStyle = colors.okr;
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'left';
        ctx.fillText(`ОКР (Ввод: ${entryPoint === 'attic' ? 'Чердак' : 'Подвал'})`, 10, entryY - 10);

        ctx.fillStyle = colors.rsh;
        ctx.fillRect(rshX - 10, entryY - 10, 20, 20);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 9px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('РШ', rshX, entryY + 4);

        // 3. Медная магистраль и стояки
        ctx.beginPath();
        ctx.strokeStyle = colors.copper;
        ctx.lineWidth = 2;
        ctx.moveTo(rshX, entryY);
        ctx.lineTo(marginX + bWidth - entWidth / 2, entryY);
        ctx.stroke();

        let globalAptCounter = 1;
        for (let e = 0; e < entrances; e++) {
            const riserX = marginX + e * entWidth + entWidth / 2;
            
            // Отрисовка стояка (вертикаль)
            ctx.beginPath();
            ctx.strokeStyle = colors.copper;
            ctx.lineWidth = 2;
            ctx.moveTo(riserX, entryY);
            ctx.lineTo(riserX, marginY + floorHeightPx); 
            ctx.lineTo(riserX, marginY + bHeight - floorHeightPx);
            ctx.stroke();

            // Массив для хранения координат КР для отрисовки поверх разводки
            const krToDraw = [];
            const kruToDraw = [];

            for (let f = 1; f <= floors; f++) {
                const r = floors - f + 1;
                const floorY = marginY + r * floorHeightPx + floorHeightPx / 2;
                
                // Отрисовка коробочек квартира
                const aptSpacing = entWidth / (aptsPerFloor + 1);
                const aptBoxes = [];

                for (let a = 1; a <= aptsPerFloor; a++) {
                    const aptX = marginX + e * entWidth + a * aptSpacing;
                    const aptY = floorY;
                    
                    // Рисуем коробочку квартиры
                    ctx.fillStyle = isDark ? '#334155' : '#f1f5f9';
                    ctx.strokeStyle = colors.building;
                    ctx.lineWidth = 1;
                    ctx.fillRect(aptX - 8, aptY - 8, 16, 16);
                    ctx.strokeRect(aptX - 8, aptY - 8, 16, 16);
                    
                    // Номер квартиры
                    ctx.fillStyle = colors.textMuted;
                    ctx.font = '8px Arial';
                    ctx.textAlign = 'center';
                    ctx.fillText(globalAptCounter++, aptX, aptY + 3);
                    
                    aptBoxes.push({ x: aptX, y: aptY });
                }

                // Логика соединений
                const isEven = (f % 2 === 0);
                const isLastOdd = (f === floors && floors % 2 !== 0);

                if (isEven || isLastOdd) {
                    // КР на этом этаже
                    krToDraw.push({ x: riserX, y: floorY });

                    // Разводка к квартирам ЭТОГО этажа от КР
                    aptBoxes.forEach(apt => {
                        ctx.beginPath();
                        ctx.strokeStyle = colors.horiz;
                        ctx.lineWidth = 1;
                        ctx.moveTo(riserX, floorY);
                        ctx.lineTo(apt.x, apt.y);
                        ctx.stroke();
                    });

                    // Если это четный этаж, обслуживаем и нижний через КРУ
                    if (isEven && f > 1) {
                        const lowerFloorY = floorY + floorHeightPx;
                        kruToDraw.push({ x: riserX - 4, y: lowerFloorY });

                        // Линия от КР вниз к КРУ
                        ctx.beginPath();
                        ctx.strokeStyle = colors.horiz;
                        ctx.setLineDash([2, 2]);
                        ctx.moveTo(riserX - 4, floorY);
                        ctx.lineTo(riserX - 4, lowerFloorY);
                        ctx.stroke();
                        ctx.setLineDash([]);

                        // Разводка от КРУ к квартирам нижнего этажа
                        for (let a = 1; a <= aptsPerFloor; a++) {
                            const lowerAptX = marginX + e * entWidth + a * aptSpacing;
                            ctx.beginPath();
                            ctx.strokeStyle = colors.horiz;
                            ctx.moveTo(riserX - 4, lowerFloorY);
                            ctx.lineTo(lowerAptX, lowerFloorY);
                            ctx.stroke();
                        }
                    }
                }
            }

            // Отрисовка самих узлов КР и КРУ поверх линий
            kruToDraw.forEach(kru => {
                ctx.fillStyle = colors.kru;
                ctx.beginPath();
                ctx.arc(kru.x, kru.y, 4, 0, Math.PI * 2);
                ctx.fill();
            });
            krToDraw.forEach(kr => {
                ctx.fillStyle = colors.kr;
                ctx.fillRect(kr.x - 5, kr.y - 5, 10, 10);
            });
        }
    }

    // Инициализация расчета по умолчанию при загрузке
    form.dispatchEvent(new Event('submit'));
});
