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

    // Переключение пользовательских параметров и автоподстановка подъездов
    seriesSelect.addEventListener('change', (e) => {
        const selectedSeries = e.target.value;
        
        // Автоподстановка подъездов для выбранной серии
        if (seriesEntrances[selectedSeries]) {
            document.getElementById('entrances').value = seriesEntrances[selectedSeries];
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
            entrances: parseInt(formData.get('entrances'), 10) || 1
        };

        if (series === 'custom') {
            payload.customParams = {
                floors: parseInt(formData.get('floors')),
                aptsPerFloor: parseInt(formData.get('aptsPerFloor')),
                floorHeight: parseFloat(formData.get('floorHeight')),
                corridorLength: parseFloat(formData.get('corridorLength')),
                routingType: formData.get('routingType')
            };
        }

        try {
            const response = await fetch('http://localhost:3000/calculate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json();
            if (response.ok) {
                window.lastCalculationData = data;
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

    // Визуализация на Canvas
    function drawBuildingCanvas(data) {
        const canvas = document.getElementById('buildingCanvas');
        const ctx = canvas.getContext('2d');
        const { floors, entrances, routingType, aptsPerFloor } = data.building;
        const tech = data.technology;
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

        // Очистка
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Цвета линий в зависимости от технологии и темы
        const colors = {
            ats: '#ef4444',     // Красный (от АТС)
            distFTTH: '#f97316', // Оранжевый (Оптика)
            distFTTB: '#3b82f6', // Синий (Оптика до подвала, далее медь)
            horiz: '#10b981',    // Зеленый (UTP/Дроп)
            mainNode: '#8b5cf6', // Фиолетовый (Муфта/Коммутатор)
            floorNode: '#f59e0b',// Желтый (Этажная коробка)
            building: isDark ? '#475569' : '#cbd5e1', // Контур здания
            textMain: isDark ? '#f8fafc' : '#1e293b',
            textMuted: isDark ? '#94a3b8' : '#64748b'
        };

        const distColor = tech === 'FTTH' ? colors.distFTTH : colors.distFTTB;

        // Настройки отрисовки
        const marginX = 100; // Отступ слева для АТС
        const marginY = 50;
        const bWidth = 600;
        const bHeight = 450;
        
        // Размеры секций
        const entWidth = bWidth / entrances;
        const totalLevels = floors + 2; // +1 чердак (тех этаж), +1 подвал
        const floorHeightPx = bHeight / totalLevels;

        // 1. Отрисовка контура здания
        ctx.strokeStyle = colors.building;
        ctx.lineWidth = 2;
        ctx.strokeRect(marginX, marginY, bWidth, bHeight);
        
        // Сетка этажей и подъездов
        ctx.beginPath();
        for (let i = 1; i < totalLevels; i++) {
            ctx.moveTo(marginX, marginY + i * floorHeightPx);
            ctx.lineTo(marginX + bWidth, marginY + i * floorHeightPx);
        }
        for (let i = 1; i < entrances; i++) {
            ctx.moveTo(marginX + i * entWidth, marginY);
            ctx.lineTo(marginX + i * entWidth, marginY + bHeight);
        }
        ctx.stroke();

        // Обозначения этажей
        ctx.fillStyle = colors.textMain;
        ctx.font = '12px Arial';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        
        for (let r = 0; r < totalLevels; r++) {
            const yCenter = marginY + r * floorHeightPx + floorHeightPx / 2;
            let text = '';
            if (r === 0) text = 'Чердак';
            else if (r === totalLevels - 1) text = 'Подвал';
            else text = `Этаж ${floors - r + 1}`;
            
            ctx.fillText(text, marginX - 10, yCenter);
        }

        // Обозначения номеров квартир
        ctx.textAlign = 'center';
        ctx.fillStyle = colors.textMuted;
        ctx.font = '11px Arial';
        
        let currentApt = 1;
        for (let e = 0; e < entrances; e++) {
            for (let f = 1; f <= floors; f++) {
                const r = floors - f + 1;
                const cellXCenter = marginX + e * entWidth + entWidth / 2;
                const cellYCenter = marginY + r * floorHeightPx + floorHeightPx / 2;
                
                const startApt = currentApt;
                const endApt = currentApt + aptsPerFloor - 1;
                ctx.fillText(`кв ${startApt}-${endApt}`, cellXCenter, cellYCenter - Math.min(15, floorHeightPx * 0.3));
                
                currentApt += aptsPerFloor;
            }
        }
        ctx.textAlign = 'left'; // Сброс выравнивания

        // 2. Линия от АТС
        const atsY = marginY + bHeight - floorHeightPx / 2; // Ввод в подвал
        ctx.beginPath();
        ctx.strokeStyle = colors.ats;
        ctx.lineWidth = 3;
        ctx.moveTo(10, atsY);
        ctx.lineTo(marginX, atsY);
        ctx.stroke();
        
        // Подпись АТС
        ctx.fillStyle = colors.ats;
        ctx.font = '12px Arial';
        ctx.fillText('АТС', 10, atsY - 10);

        // 3. Главный узел в здании (в подвале первого подъезда)
        const mainNodeX = marginX + entWidth / 2;
        const mainNodeY = marginY + bHeight - floorHeightPx / 2;
        
        ctx.beginPath();
        ctx.arc(mainNodeX, mainNodeY, 8, 0, Math.PI * 2);
        ctx.fillStyle = colors.mainNode;
        ctx.fill();

        // 4. Трассировка распределительной сети (стояки)
        ctx.beginPath();
        ctx.strokeStyle = distColor;
        ctx.lineWidth = 2;
        
        // Линия по подвалу ко всем подъездам
        ctx.moveTo(mainNodeX, mainNodeY);
        ctx.lineTo(marginX + bWidth - entWidth / 2, mainNodeY);
        
        // Вертикальные стояки в каждом подъезде
        const floorNodesCoords = [];
        
        for (let e = 0; e < entrances; e++) {
            const entCenter = marginX + e * entWidth + entWidth / 2;
            
            // Стояк идет вверх
            ctx.moveTo(entCenter, mainNodeY);
            
            // Если внешняя прокладка, рисуем линию до чердака (r=0)
            if (routingType === 'external') {
                ctx.lineTo(entCenter, marginY + floorHeightPx / 2); 
            } else {
                ctx.lineTo(entCenter, marginY + floorHeightPx * 1.5); // До верхнего жилого этажа (r=1)
            }

            // Отмечаем точки для этажных коробок (только на жилых этажах)
            for (let f = 1; f <= floors; f++) {
                const r = floors - f + 1;
                const floorCenterY = marginY + r * floorHeightPx + floorHeightPx / 2;
                floorNodesCoords.push({ x: entCenter, y: floorCenterY });
            }
        }
        ctx.stroke();

        // 5. Отрисовка этажных узлов и горизонтальной разводки
        floorNodesCoords.forEach(node => {
            // Рисуем отводы к квартирам (горизонталь)
            ctx.beginPath();
            ctx.strokeStyle = colors.horiz;
            ctx.lineWidth = 1.5;
            // Влево и вправо от стояка
            ctx.moveTo(node.x, node.y);
            ctx.lineTo(node.x - entWidth / 3, node.y);
            ctx.moveTo(node.x, node.y);
            ctx.lineTo(node.x + entWidth / 3, node.y);
            ctx.stroke();

            // Рисуем саму коробку (сплиттер/коммутатор)
            ctx.fillStyle = colors.floorNode;
            ctx.fillRect(node.x - 4, node.y - 4, 8, 8);
        });

        // Добавим пояснительный текст
        ctx.fillStyle = colors.textMain;
        ctx.font = '14px Arial';
        ctx.fillText(`Схема здания: ${entrances} подъездов, ${floors} жилых этажей`, marginX, marginY - 20);
    }

    // Инициализация расчета по умолчанию при загрузке
    form.dispatchEvent(new Event('submit'));
});
