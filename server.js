const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Добавляем поддержку CORS для работы с Live Server или file:///
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// База данных параметров для российских серий домов
const buildingSeries = {
    'pik': {
        name: 'Современный монолит (типа ПИК)',
        floors: 25,
        entrances: 1,
        aptsPerFloor: 12,
        floorHeight: 2.9,
        corridorLength: 20,
        routingType: 'internal'
    },
    'p44': {
        name: 'П-44/П-44Т (17 эт, 4 под)',
        floors: 17,
        entrances: 4,
        aptsPerFloor: 4,
        floorHeight: 2.8,
        corridorLength: 10,
        routingType: 'internal'
    },
    'i155': {
        name: 'И-155 (Башня 24 эт)',
        floors: 24,
        entrances: 1,
        aptsPerFloor: 8,
        floorHeight: 2.8,
        corridorLength: 15,
        routingType: 'internal'
    },
    'brezhnevka': {
        name: 'Брежневка (II-49, 9 эт)',
        floors: 9,
        entrances: 4,
        aptsPerFloor: 4,
        floorHeight: 2.6,
        corridorLength: 10,
        routingType: 'internal'
    },
    'khrushchev': {
        name: 'Хрущевка 1-510/1-515 (5 эт)',
        floors: 5,
        entrances: 4,
        aptsPerFloor: 4,
        floorHeight: 2.5,
        corridorLength: 8,
        routingType: 'external'
    },
    'stalin': {
        name: 'Сталинка',
        floors: 5,
        entrances: 3,
        aptsPerFloor: 3,
        floorHeight: 3.2,
        corridorLength: 12,
        routingType: 'internal'
    }
};

// Прайс-лист в рублях
const prices = {
    cableTrunkOptic: 45,      // Магистральная оптика (руб/м)
    cableDistOptic: 30,       // Распределительная оптика (руб/м)
    cableDropOptic: 15,       // Дроп-кабель FTTH (руб/м)
    cableUtp: 20,             // UTP медь (руб/м)
    switchAccess: 15000,      // Коммутатор доступа 24 порта
    switchAggr: 40000,        // Коммутатор агрегации
    spliceBox: 3500,          // Оптическая муфта / кросс
    floorBox: 800,            // Этажная коробка
    connectorFast: 100,       // Fast-коннектор (оптика)
    connectorRj45: 15,        // RJ-45 коннектор
    spliceWork: 250,          // Сварка оптики (1 волокно)
    splitters: {
        2: 400, 4: 500, 8: 700, 16: 1200, 32: 2500, 64: 5000
    }
};

// Параметры потерь для FTTH (дБ)
const opticalLosses = {
    cablePerKm: 0.3,
    connector: 0.5,
    splice: 0.1,
    splitters: {
        2: 3.5, 4: 7.2, 8: 10.5, 16: 13.8, 32: 17.1, 64: 20.5
    }
};

function calculateSplitters(totalSubscribers, entrances, floors) {
    const splitters = { 2: 0, 4: 0, 8: 0, 16: 0, 32: 0, 64: 0 };
    const subsPerEntrance = Math.ceil(totalSubscribers / entrances);
    
    let l1SplitterRatio = 1;
    let l2SplitterRatio = 1;

    const aptsPerFloor = Math.ceil(subsPerEntrance / floors);
    const availableRatios = [2, 4, 8, 16, 32, 64];
    
    let subsPerGroup = aptsPerFloor * 2; 
    l2SplitterRatio = availableRatios.find(r => r >= subsPerGroup) || 64;
    
    const l2CountPerEntrance = Math.ceil(subsPerEntrance / l2SplitterRatio);
    const totalL2Count = l2CountPerEntrance * entrances;
    
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
    const { series, technology, distanceAts, customParams } = req.body;

    let bParams = series === 'custom' ? customParams : buildingSeries[series];
    if (!bParams) {
        return res.status(400).json({ error: 'Неверные параметры здания' });
    }

    const { floors, entrances, aptsPerFloor, floorHeight, corridorLength, routingType } = bParams;
    const totalSubscribers = floors * entrances * aptsPerFloor;

    const trunkCable = parseFloat(distanceAts); 
    const verticalCablePerEntrance = floors * floorHeight;
    const totalVerticalCable = verticalCablePerEntrance * entrances;
    const averageDistanceToApt = corridorLength / 2;
    
    let horizontalCable = 0;
    let distributionCable = 0; 

    if (technology === 'FTTB') {
        distributionCable = entrances * corridorLength; 
        const avgDropVertical = verticalCablePerEntrance / 2;
        const avgDropLength = avgDropVertical + averageDistanceToApt;
        horizontalCable = totalSubscribers * avgDropLength; 
    } else if (technology === 'FTTH') {
        distributionCable = entrances * corridorLength + totalVerticalCable; 
        horizontalCable = totalSubscribers * averageDistanceToApt; 
    }

    const totalCableLength = trunkCable + distributionCable + horizontalCable;

    let splittersData = null;
    let opticalBudget = null;

    if (technology === 'FTTH') {
        splittersData = calculateSplitters(totalSubscribers, entrances, floors);
        const maxDistanceKm = (trunkCable + corridorLength * entrances + floors * floorHeight + corridorLength) / 1000;
        opticalBudget = calculateOpticalBudget(maxDistanceKm, splittersData.l1Ratio, splittersData.l2Ratio, 4, 4);
    }

    const calculateEstimate = (cableDist) => ({
        trunk: Math.ceil(trunkCable),
        distribution: Math.ceil(distributionCable),
        horizontal: Math.ceil(horizontalCable),
        total: Math.ceil(cableDist)
    });

    const pureEstimate = calculateEstimate(totalCableLength);
    const reserveEstimate = {
        trunk: Math.ceil(pureEstimate.trunk * 1.15),
        distribution: Math.ceil(pureEstimate.distribution * 1.15),
        horizontal: Math.ceil(pureEstimate.horizontal * 1.15),
        total: Math.ceil(pureEstimate.total * 1.15)
    };

    // Расчет сметы
    const materials = [];

    materials.push({
        name: 'Магистральный оптический кабель',
        qty: reserveEstimate.trunk,
        unit: 'м',
        price: prices.cableTrunkOptic,
        total: reserveEstimate.trunk * prices.cableTrunkOptic
    });

    if (technology === 'FTTB') {
        materials.push({
            name: 'Распределительный оптический кабель',
            qty: reserveEstimate.distribution,
            unit: 'м',
            price: prices.cableDistOptic,
            total: reserveEstimate.distribution * prices.cableDistOptic
        });
        materials.push({
            name: 'Абонентский кабель UTP (Витая пара)',
            qty: reserveEstimate.horizontal,
            unit: 'м',
            price: prices.cableUtp,
            total: reserveEstimate.horizontal * prices.cableUtp
        });
        
        materials.push({
            name: 'Агрегационный коммутатор (на дом)',
            qty: 1,
            unit: 'шт',
            price: prices.switchAggr,
            total: prices.switchAggr
        });
        const accessSwitches = Math.ceil(totalSubscribers / 24);
        materials.push({
            name: 'Коммутатор доступа (24 порта)',
            qty: accessSwitches,
            unit: 'шт',
            price: prices.switchAccess,
            total: accessSwitches * prices.switchAccess
        });
        const rj45Count = totalSubscribers * 2;
        materials.push({
            name: 'Коннекторы RJ-45',
            qty: rj45Count,
            unit: 'шт',
            price: prices.connectorRj45,
            total: rj45Count * prices.connectorRj45
        });
        
        materials.push({
            name: 'Оптическая муфта (главный узел)',
            qty: 1,
            unit: 'шт',
            price: prices.spliceBox,
            total: prices.spliceBox
        });
        
        const splicesCount = entrances * 2 + 4; 
        materials.push({
            name: 'Сварка оптических волокон',
            qty: splicesCount,
            unit: 'шт',
            price: prices.spliceWork,
            total: splicesCount * prices.spliceWork
        });
        
    } else if (technology === 'FTTH') {
        materials.push({
            name: 'Распределительный оптический кабель (стояки)',
            qty: reserveEstimate.distribution,
            unit: 'м',
            price: prices.cableDistOptic,
            total: reserveEstimate.distribution * prices.cableDistOptic
        });
        materials.push({
            name: 'Абонентский дроп-кабель (оптика)',
            qty: reserveEstimate.horizontal,
            unit: 'м',
            price: prices.cableDropOptic,
            total: reserveEstimate.horizontal * prices.cableDropOptic
        });

        materials.push({
            name: 'Оптическая муфта (главный узел)',
            qty: 1,
            unit: 'шт',
            price: prices.spliceBox,
            total: prices.spliceBox
        });

        const l1Count = splittersData.counts[splittersData.l1Ratio];
        const l1Price = prices.splitters[splittersData.l1Ratio] || 5000;
        materials.push({
            name: `Сплиттер магистральный 1x${splittersData.l1Ratio}`,
            qty: l1Count,
            unit: 'шт',
            price: l1Price,
            total: l1Count * l1Price
        });

        const l2Count = splittersData.counts[splittersData.l2Ratio];
        const l2Price = prices.splitters[splittersData.l2Ratio] || 1000;
        materials.push({
            name: `Сплиттер этажный 1x${splittersData.l2Ratio}`,
            qty: l2Count,
            unit: 'шт',
            price: l2Price,
            total: l2Count * l2Price
        });

        materials.push({
            name: 'Этажная распределительная коробка',
            qty: l2Count, 
            unit: 'шт',
            price: prices.floorBox,
            total: l2Count * prices.floorBox
        });

        const fastConnCount = totalSubscribers * 2;
        materials.push({
            name: 'Оптические Fast-коннекторы',
            qty: fastConnCount,
            unit: 'шт',
            price: prices.connectorFast,
            total: fastConnCount * prices.connectorFast
        });
        
        const splicesCount = l1Count * 2 + l2Count * 2 + 4; 
        materials.push({
            name: 'Сварка оптических волокон',
            qty: splicesCount,
            unit: 'шт',
            price: prices.spliceWork,
            total: splicesCount * prices.spliceWork
        });
    }

    const totalCost = materials.reduce((sum, m) => sum + m.total, 0);

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
        finance: {
            items: materials,
            total: totalCost
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