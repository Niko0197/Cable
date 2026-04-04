document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('calc-form');
    const seriesSelect = document.getElementById('series');
    const customParamsDiv = document.getElementById('custom-params');
    const tabs = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    // Переключение пользовательских параметров
    seriesSelect.addEventListener('change', (e) => {
        if (e.target.value === 'custom') {
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
        };

        if (series === 'custom') {
            payload.customParams = {
                floors: parseInt(formData.get('floors')),
                entrances: parseInt(formData.get('entrances')),
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
        document.getElementById('est-pure-trunk').textContent = data.estimates.pure.trunk;
        document.getElementById('est-pure-dist').textContent = data.estimates.pure.distribution;
        document.getElementById('est-pure-horiz').textContent = data.estimates.pure.horizontal;
        document.getElementById('est-pure-total').textContent = data.estimates.pure.total;

        // Смета с запасом
        document.getElementById('est-res-trunk').textContent = data.estimates.withReserve.trunk;
        document.getElementById('est-res-dist').textContent = data.estimates.withReserve.distribution;
        document.getElementById('est-res-horiz').textContent = data.estimates.withReserve.horizontal;
        document.getElementById('est-res-total').textContent = data.estimates.withReserve.total;

        // Финансы
        if (data.finance) {
            document.getElementById('res-total-cost').textContent = data.finance.total.toLocaleString('ru-RU') + ' ₽';
            const costPerSub = Math.round(data.finance.total / data.building.totalSubscribers);
            document.getElementById('res-cost-per-sub').textContent = costPerSub.toLocaleString('ru-RU') + ' ₽';
            
            const tbody = document.getElementById('finance-tbody');
            tbody.innerHTML = '';
            data.finance.items.forEach(item => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${item.name}</td>
                    <td>${item.qty}</td>
                    <td>${item.unit}</td>
                    <td>${item.price.toLocaleString('ru-RU')}</td>
                    <td style="font-weight: bold;">${item.total.toLocaleString('ru-RU')}</td>
                `;
                tbody.appendChild(tr);
            });
        }
    }

    // Визуализация на Canvas
    function drawBuildingCanvas(data) {
        const canvas = document.getElementById('buildingCanvas');
        const ctx = canvas.getContext('2d');
        const { floors, entrances, routingType, aptsPerFloor } = data.building;
        const tech = data.technology;

        // Очистка
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Цвета линий в зависимости от технологии
        const colors = {
            ats: '#ef4444',     // Красный (от АТС)
            distFTTH: '#f97316', // Оранжевый (Оптика)
            distFTTB: '#3b82f6', // Синий (Оптика до подвала, далее медь)
            horiz: '#10b981',    // Зеленый (UTP/Дроп)
            mainNode: '#8b5cf6', // Фиолетовый (Муфта/Коммутатор)
            floorNode: '#f59e0b',// Желтый (Этажная коробка)
            building: '#cbd5e1'  // Серый
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
        ctx.fillStyle = '#1e293b';
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
        ctx.fillStyle = '#64748b';
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
        ctx.fillStyle = '#1e293b';
        ctx.font = '14px Arial';
        ctx.fillText(`Схема здания: ${entrances} подъездов, ${floors} жилых этажей`, marginX, marginY - 20);
    }

    // Инициализация расчета по умолчанию при загрузке
    form.dispatchEvent(new Event('submit'));
});
