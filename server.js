const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// База данных параметров для российских серий домов
const buildingSeries = {
    'p44': {
        name: 'П-44/П-44Т',
        floors: 17,
        entrances: 4,
        aptsPerFloor: 4,
        floorHeight: 2.8,
        corridorLength: 10,
        routingType: 'internal' // внутренние кабель-каналы (стояки)
    },
    'khrushchev': {
        name: 'Хрущевка 1-510/1-515',
        floors: 5,
        entrances: 4,
        aptsPerFloor: 4,
        floorHeight: 2.5,
        corridorLength: 8,
        routingType: 'external' // внешняя прокладка по фасаду/чердаку
    },
    'stalin': {
        name: 'Сталинка',
        floors: 5,
        entrances: 3,
        aptsPerFloor: 3,
        floorHeight: 3.2,
        corridorLength: 12,
        routingType: 'internal' // внутренние стояки, высокие потолки, толстые стены
    }
};

// Параметры потерь для FTTH (дБ)
const opticalLosses = {
    cablePerKm: 0.3, // Потери в оптическом кабеле на 1 км (для длины волны 1310/1550 нм)
    connector: 0.5, // Потери на коннекторах
    splice: 0.1,    // Потери на сварку
    // Теоретические (с небольшим запасом) потери на оптических сплиттерах
    splitters: {
        2: 3.5,
        4: 7.2,
        8: 10.5,
        16: 13.8,
        32: 17.1,
        64: 20.5
    }
};

/**
 * Алгоритм расчета сплиттеров для FTTH
 * Подбирает оптимальную двухуровневую древовидную топологию.
 * 1 уровень - магистральный сплиттер (в муфте в подвале/на чердаке).
 * 2 уровень - этажные сплиттеры (или подъездные).
 */
function calculateSplitters(totalSubscribers, entrances, floors) {
    const splitters = { 2: 0, 4: 0, 8: 0, 16: 0, 32: 0, 64: 0 };
    
    // Для простоты моделирования: 
    // Предположим, мы ставим 1 магистральный сплиттер на дом (или на подъезд, если дом большой)
    // И сплиттеры второго уровня на каждые несколько этажей или на каждый этаж
    
    // Рассчитаем абонентов на подъезд
    const subsPerEntrance = Math.ceil(totalSubscribers / entrances);
    
    let l1SplitterRatio = 1;
    let l2SplitterRatio = 1;

    // Подбираем сплиттер 2-го уровня (в подъезде/на этажах)
    // Смотрим сколько абонентов на этаже
    const aptsPerFloor = Math.ceil(subsPerEntrance / floors);
    
    // Если на этаже 4 квартиры, логично поставить 1:4 на этаж или 1:8 на два этажа
    const availableRatios = [2, 4, 8, 16, 32, 64];
    
    // Ищем подходящий сплиттер для группы абонентов (например, 1 сплиттер на 2 этажа)
    let subsPerGroup = aptsPerFloor * 2; 
    l2SplitterRatio = availableRatios.find(r => r >= subsPerGroup) || 64;
    
    // Количество сплиттеров 2 уровня в подъезде
    const l2CountPerEntrance = Math.ceil(subsPerEntrance / l2SplitterRatio);
    const totalL2Count = l2CountPerEntrance * entrances;
    
    // Подбираем магистральный сплиттер (1 уровень)
    // Он должен запитать все сплиттеры 2 уровня
    l1SplitterRatio = availableRatios.find(r => r >= totalL2Count) || 64;
    let l1Count = Math.ceil(totalL2Count / l1SplitterRatio);

    splitters[l2SplitterRatio] = totalL2Count;
    splitters[l1SplitterRatio] = (splitters[l1SplitterRatio] || 0) + l1Count;

    return {
        topology: `1x${l1SplitterRatio} -> 1x${l2SplitterRatio}`,
        counts: splitters,
        l1Ratio: l1SplitterRatio,
        l2Ratio: l2SplitterRatio,
        totalSplitters: totalL2Count + l1Count
    };
}

/**
 * Расчет оптического бюджета (затухания) для самой дальней точки
 */
function calculateOpticalBudget(totalDistanceKm, l1Ratio, l2Ratio, splicesCount, connectorsCount) {
    const cableLoss = totalDistanceKm * opticalLosses.cablePerKm;
    const splicesLoss = splicesCount * opticalLosses.splice;
    const connectorsLoss = connectorsCount * opticalLosses.connector;
    const l1Loss = opticalLosses.splitters[l1Ratio] || 0;
    const l2Loss = opticalLosses.splitters[l2Ratio] || 0;
    
    const totalLoss = cableLoss + splicesLoss + connectorsLoss + l1Loss + l2Loss;
    return parseFloat(totalLoss.toFixed(2));
}

app.post('/calculate', (req, res) => {
    const { 
        series, 
        technology, // 'FTTB' или 'FTTH'
        distanceAts, // в метрах
        customParams 
    } = req.body;

    // Определяем параметры здания
    let bParams = series === 'custom' ? customParams : buildingSeries[series];
    if (!bParams) {
        return res.status(400).json({ error: 'Неверные параметры здания' });
    }

    const { floors, entrances, aptsPerFloor, floorHeight, corridorLength, routingType } = bParams;
    const totalSubscribers = floors * entrances * aptsPerFloor;

    // --- 1. Расчет длины кабеля ---
    // Магистраль до дома
    const trunkCable = parseFloat(distanceAts); 
    
    // Вертикальная прокладка (стояки)
    // В каждом подъезде кабель идет с 1 до последнего этажа.
    const verticalCablePerEntrance = floors * floorHeight;
    const totalVerticalCable = verticalCablePerEntrance * entrances;

    // Горизонтальная прокладка
    // От стояка до квартиры в среднем половина длины коридора
    const averageDistanceToApt = corridorLength / 2;
    let horizontalCable = 0;
    let distributionCable = 0; // Кабель внутри здания до этажных коробок

    if (technology === 'FTTB') {
        // FTTB: Оптика идет до коммутатора в подвале/чердаке, далее витая пара (Ethernet) до каждой квартиры
        // Предполагаем коммутаторы на каждый подъезд
        distributionCable = entrances * corridorLength; // Условно, связь между подъездами
        // Витая пара: от коммутатора (подвал) до квартиры (вертикаль + горизонталь)
        // Средняя длина вертикали: (floors * floorHeight) / 2
        const avgDropVertical = verticalCablePerEntrance / 2;
        const avgDropLength = avgDropVertical + averageDistanceToApt;
        horizontalCable = totalSubscribers * avgDropLength; // Общая длина UTP кабеля
    } else if (technology === 'FTTH') {
        // FTTH: Оптика идет до квартиры.
        // Магистральный кабель до сплиттеров в доме.
        distributionCable = entrances * corridorLength + totalVerticalCable; // Оптика по стоякам до этажных сплиттеров
        horizontalCable = totalSubscribers * averageDistanceToApt; // Дроп-кабель от этажной коробки до квартиры
    }

    const totalCableLength = trunkCable + distributionCable + horizontalCable;

    // --- 2. Специфика технологий ---
    let splittersData = null;
    let opticalBudget = null;

    if (technology === 'FTTH') {
        splittersData = calculateSplitters(totalSubscribers, entrances, floors);
        
        // Расчет затухания для самой дальней точки
        const maxDistanceKm = (trunkCable + corridorLength * entrances + floors * floorHeight + corridorLength) / 1000;
        // Примерно: 4 коннектора (на кроссе АТС, на входе в дом, на сплиттерах, у абонента), 4 сварки
        opticalBudget = calculateOpticalBudget(maxDistanceKm, splittersData.l1Ratio, splittersData.l2Ratio, 4, 4);
    }

    // --- 3. Смета (метраж кабеля) ---
    const calculateEstimate = (cableDist) => {
        return {
            trunk: Math.ceil(trunkCable),
            distribution: Math.ceil(distributionCable),
            horizontal: Math.ceil(horizontalCable),
            total: Math.ceil(cableDist)
        };
    };

    const pureEstimate = calculateEstimate(totalCableLength);
    
    // Расчет с 15% запасом (коэффициент 1.15)
    const reserveEstimate = {
        trunk: Math.ceil(pureEstimate.trunk * 1.15),
        distribution: Math.ceil(pureEstimate.distribution * 1.15),
        horizontal: Math.ceil(pureEstimate.horizontal * 1.15),
        total: Math.ceil(pureEstimate.total * 1.15)
    };

    // --- 4. Формирование ответа ---
    res.json({
        building: {
            totalSubscribers,
            ...bParams
        },
        technology,
        estimates: {
            pure: pureEstimate,
            withReserve: reserveEstimate
        },
        ftthDetails: technology === 'FTTH' ? {
            splitters: splittersData,
            opticalBudgetDb: opticalBudget
        } : null
    });
});

app.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});
