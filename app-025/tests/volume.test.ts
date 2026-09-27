import { describe, it, expect } from 'vitest';
import {
  grossVolumeL,
  substrateVolumeL,
  substrateWeightKg,
  substrateAvgThicknessCm,
  hardscapeDisplacementL,
  effectiveVolumeL,
  waterHeightCm,
  waterSurfaceAreaM2,
} from '../src/core/volume';
import type { Substrate, Tank, Item } from '../src/core/types';

function tank(p: Partial<Tank> = {}): Tank {
  return { id: 't', name: 'T', l: 60, w: 45, h: 45, glassMm: 8, waterLevelMm: 390, openTop: true, ...p };
}
function sub(p: Partial<Substrate> = {}): Substrate {
  return { kind: 'soil', densityKgPerL: 1.05, thicknessMm: 50, slopeMm: 60, ...p };
}

/** 可复现的伪随机（mulberry32） */
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('水量与底砂计算（验收：随机 50 组与手工核算一致，误差 ≤ 2%）', () => {
  const rand = mulberry32(20260917);
  const cases = Array.from({ length: 50 }, () => {
    const l = 20 + Math.round(rand() * 280); // 20~300cm
    const w = 20 + Math.round(rand() * 80);
    const h = 20 + Math.round(rand() * 80);
    const waterLevelMm = Math.round(rand() * h * 10);
    const thicknessMm = Math.round(rand() * 120); // 0~120mm
    const slopeMm = Math.round(rand() * 150);
    const densityKgPerL = 1 + rand() * 0.7; // 1.0~1.7
    return { tank: tank({ l, w, h, waterLevelMm }), sub: sub({ thicknessMm, slopeMm, densityKgPerL }) };
  });

  it.each(cases.map((c, i) => [i, c] as const))(
    'case #%i: %sx%sx%s cm, 水面 %smm, 底砂 %s+%smm @%skg/L',
    (_i, { tank: t, sub: s }) => {
      // 手工核算（独立算式，不经被测模块）
      const waterCm = Math.min(t.h, t.waterLevelMm / 10);
      const manualGross = (t.l * t.w * waterCm) / 1000;
      const avgThick = s.thicknessMm / 10 + s.slopeMm / 10 / 2;
      const manualSubVol = (t.l * t.w * avgThick) / 1000;
      const manualWeight = manualSubVol * s.densityKgPerL;

      expect(waterHeightCm(t)).toBeCloseTo(waterCm, 6);
      expect(grossVolumeL(t)).toBeCloseTo(manualGross, 3);
      expect(substrateVolumeL(t, s)).toBeCloseTo(manualSubVol, 3);
      expect(substrateWeightKg(t, s)).toBeCloseTo(manualWeight, 3);

      // 误差 ≤ 2%（相对手工值）
      const errGross = Math.abs(grossVolumeL(t) - manualGross) / (manualGross || 1);
      const errWeight = Math.abs(substrateWeightKg(t, s) - manualWeight) / (manualWeight || 1);
      expect(errGross).toBeLessThanOrEqual(0.02);
      expect(errWeight).toBeLessThanOrEqual(0.02);
    },
  );
});

describe('有效水量必须扣除底砂与素材（专门用例）', () => {
  it('有效水量 = 毛水量 − 底砂体积 − 素材排水体积', () => {
    const t = tank(); // 60×45×45, 水面 390mm → 39cm 水柱
    const s = sub({ thicknessMm: 50, slopeMm: 60, densityKgPerL: 1.05 });
    const items: Item[] = [
      { id: 'h1', kind: 'hardscape', name: '青龙石', x: 10, y: 10, scaleCm: 20, rotDeg: 0, displacement: 0.55, shape: 'rock' },
      { id: 'p1', kind: 'plant', name: '铁皇冠', x: 20, y: 20, scaleCm: 15, rotDeg: 0, qty: 5 },
    ];
    const gross = grossVolumeL(t);
    const subVol = substrateVolumeL(t, s);
    const displace = hardscapeDisplacementL(items);
    const eff = effectiveVolumeL(t, s, items);

    // 手工核对
    expect(gross).toBeCloseTo((60 * 45 * 39) / 1000, 6); // 105.3L
    expect(subVol).toBeCloseTo((60 * 45 * (5 + 3)) / 1000, 6); // 21.6L
    // 硬景观：20cm 石，包围盒 20×0.7×20×0.7×20/1000 = 3.92L × 0.55
    expect(displace).toBeCloseTo(((20 * 0.7 * 20 * 0.7 * 20) / 1000) * 0.55, 6);
    expect(eff).toBeCloseTo(gross - subVol - displace, 6);
    // 底砂+素材确实被扣除
    expect(eff).toBeLessThan(gross);
    expect(eff).toBeCloseTo(gross - subVol - displace, 9);
  });

  it('水草不计入排水体积', () => {
    const t = tank();
    const s = sub();
    const plants: Item[] = [
      { id: 'p1', kind: 'plant', name: 'A', x: 0, y: 0, scaleCm: 30, rotDeg: 0 },
      { id: 'p2', kind: 'plant', name: 'B', x: 0, y: 0, scaleCm: 40, rotDeg: 0 },
    ];
    expect(hardscapeDisplacementL(plants)).toBe(0);
    expect(effectiveVolumeL(t, s, plants)).toBeCloseTo(grossVolumeL(t) - substrateVolumeL(t, s), 9);
  });

  it('极端参数不出现负水量', () => {
    const t = tank({ l: 40, w: 30, h: 30, waterLevelMm: 300 });
    const s = sub({ thicknessMm: 200, slopeMm: 100 }); // 底砂比水还深
    expect(effectiveVolumeL(t, s, [])).toBeGreaterThanOrEqual(0);
  });

  it('水面高度被缸高夹取（超注水不溢出）', () => {
    const t = tank({ h: 30, waterLevelMm: 500 });
    expect(waterHeightCm(t)).toBe(30);
    expect(grossVolumeL(t)).toBeCloseTo((60 * 45 * 30) / 1000, 6);
  });

  it('底砂平均厚度 = 基础 + 坡度/2', () => {
    expect(substrateAvgThicknessCm(sub({ thicknessMm: 40, slopeMm: 80 }))).toBeCloseTo(4 + 4, 9);
  });

  it('水面面积(m²)', () => {
    expect(waterSurfaceAreaM2(tank({ l: 100, w: 50 }))).toBeCloseTo(0.5, 9);
  });
});

describe('水面高度边界 → 毛水量（算法：水柱 = max(0, min(缸高, 水面mm/10))；毛水量 = l×w×水柱/1000）', () => {
  // 基准缸 60×45×45cm，满缸毛水量 = 60×45×45/1000 = 121.5L
  const t = (waterLevelMm: number) => tank({ l: 60, w: 45, h: 45, waterLevelMm });

  it('水面正好等于缸高（450mm = 45cm）：不触发夹取，毛水量 = 121.5L', () => {
    expect(waterHeightCm(t(450)), '水柱高度 = min(45, 450/10=45) = 45cm').toBe(45);
    expect(grossVolumeL(t(450)), '毛水量 = 60×45×45/1000 = 121.5L').toBeCloseTo(121.5, 9);
  });

  it('水面超过缸高（451mm、600mm）：被缸高夹取，毛水量仍为 121.5L，不溢出', () => {
    for (const mm of [451, 600]) {
      expect(waterHeightCm(t(mm)), `水面 ${mm}mm/10=${mm / 10}cm 应被缸高 45cm 夹取为 45`).toBe(45);
      expect(grossVolumeL(t(mm)), `水面 ${mm}mm 超注，毛水量应与满缸相同 121.5L`).toBeCloseTo(121.5, 9);
    }
  });

  it('水面为零（0mm）：水柱 0，毛水量 0', () => {
    expect(waterHeightCm(t(0)), '水柱高度 = min(45, 0/10) = 0').toBe(0);
    expect(grossVolumeL(t(0)), '毛水量 = 60×45×0/1000 = 0').toBe(0);
  });

  it('水面为负（-100mm）：被 max(0,·) 夹取为 0，毛水量为 0 而非负', () => {
    // min(45, -100/10) = -10 → max(0, -10) = 0
    expect(waterHeightCm(t(-100)), 'min(45, -10)=-10 应被 max(0,·) 夹取为 0').toBe(0);
    expect(grossVolumeL(t(-100)), '负水面不得产生负毛水量').toBe(0);
    expect(grossVolumeL(t(-100))).toBeGreaterThanOrEqual(0);
  });
});

describe('底砂边界与有效水量压零归因（算法：有效 = max(0, 毛水量 − 底砂体积 − 素材排水)）', () => {
  it('厚度与坡度都为零：底砂体积/重量为 0，有效水量 = 毛水量', () => {
    const t = tank(); // 60×45×45，水面 390mm → 毛水量 105.3L
    const s = sub({ thicknessMm: 0, slopeMm: 0 });
    expect(substrateAvgThicknessCm(s), '平均厚度 = max(0, 0/10 + 0/10/2) = 0').toBe(0);
    expect(substrateVolumeL(t, s), '底砂体积 = 60×45×0/1000 = 0').toBe(0);
    expect(substrateWeightKg(t, s), '底砂重量 = 0 × 密度 = 0').toBe(0);
    expect(effectiveVolumeL(t, s, []), '无扣减项，有效水量应等于毛水量 105.3L').toBeCloseTo(105.3, 9);
  });

  it('坡度为负：平均厚度被压到 0 以下时夹取为 0，底砂不占水量', () => {
    const t = tank();
    // 30mm 基础 + (-100mm) 坡度：3 + (-10)/2 = -2cm → max(0,·) = 0
    const sNeg = sub({ thicknessMm: 30, slopeMm: -100 });
    expect(substrateAvgThicknessCm(sNeg), '3 + (-10)/2 = -2cm，应被 max(0,·) 夹取为 0').toBe(0);
    expect(substrateVolumeL(t, sNeg), '平均厚度 0 → 底砂体积 0').toBe(0);
    expect(effectiveVolumeL(t, sNeg, []), '底砂被夹零后不再扣减，有效水量 = 毛水量').toBeCloseTo(
      grossVolumeL(t),
      9,
    );
    // 边界：50mm 基础 + (-100mm) 坡度：5 - 5 = 0，恰好为零
    expect(substrateAvgThicknessCm(sub({ thicknessMm: 50, slopeMm: -100 })), '5 + (-10)/2 = 0，恰好为零').toBe(0);
  });

  it('底砂平均厚度超过水柱高度：有效水量被「底砂体积」压到零', () => {
    const t = tank({ l: 40, w: 30, h: 30, waterLevelMm: 300 }); // 水柱 30cm，毛水量 36L
    const s = sub({ thicknessMm: 300, slopeMm: 200 }); // 平均厚度 30+10=40cm > 水柱 30cm
    const gross = grossVolumeL(t);
    const subVol = substrateVolumeL(t, s);
    const afterSub = gross - subVol;

    expect(substrateAvgThicknessCm(s), '平均厚度 = 300/10 + 200/10/2 = 40cm，超过水柱 30cm').toBeCloseTo(40, 9);
    expect(gross, '毛水量 = 40×30×30/1000 = 36L').toBeCloseTo(36, 9);
    expect(subVol, '底砂体积 = 40×30×40/1000 = 48L > 毛水量 36L').toBeCloseTo(48, 9);
    expect(afterSub, `第一步扣减：毛水量−底砂 = ${gross}−${subVol} = ${afterSub} ≤ 0（压零项=底砂体积）`).toBeLessThanOrEqual(0);
    expect(effectiveVolumeL(t, s, []), '有效水量被 max(0,·) 夹取为 0，不得为负').toBe(0);
  });

  it('素材排水超过毛水量：有效水量被「素材排水」压到零', () => {
    const t = tank({ l: 30, w: 20, h: 20, waterLevelMm: 200 }); // 毛水量 12L
    const s = sub({ thicknessMm: 0, slopeMm: 0 }); // 底砂不扣减
    const rock: Item = { id: 'r1', kind: 'hardscape', name: '巨石', x: 0, y: 0, scaleCm: 40, rotDeg: 0, displacement: 1.0, shape: 'rock' };
    const gross = grossVolumeL(t);
    const subVol = substrateVolumeL(t, s);
    const displace = hardscapeDisplacementL([rock]);
    const afterSub = gross - subVol;
    const afterAll = afterSub - displace;

    expect(gross, '毛水量 = 30×20×20/1000 = 12L').toBeCloseTo(12, 9);
    expect(afterSub, `第一步扣减：毛水量−底砂 = ${gross}−${subVol} = ${afterSub} > 0（底砂未压零）`).toBeGreaterThan(0);
    expect(displace, '排水 = 40×(40×0.7)×(40×0.7)/1000 × 1.0 = 31.36L').toBeCloseTo(31.36, 9);
    expect(afterAll, `第二步扣减：${afterSub}−${displace} = ${afterAll} ≤ 0（压零项=素材排水）`).toBeLessThanOrEqual(0);
    expect(effectiveVolumeL(t, s, [rock]), '有效水量被 max(0,·) 夹取为 0，不得为负').toBe(0);
  });
});

describe('硬景观排水：累加与精度（算法：逐件 包围盒=尺寸×(尺寸×0.7)²/1000 × 排水系数，求和；核心层不取整）', () => {
  const rock = (scaleCm: number, displacement?: number): Item => ({
    id: `r${scaleCm}`, kind: 'hardscape', name: '石', x: 0, y: 0, scaleCm, rotDeg: 0, shape: 'rock',
    ...(displacement !== undefined ? { displacement } : {}),
  });
  const wood = (scaleCm: number, displacement?: number): Item => ({
    id: `w${scaleCm}`, kind: 'hardscape', name: '木', x: 0, y: 0, scaleCm, rotDeg: 0, shape: 'wood',
    ...(displacement !== undefined ? { displacement } : {}),
  });

  it('只有水草：排水为 0（即使水草误带 displacement 字段也不计入）', () => {
    const plants: Item[] = [
      { id: 'p1', kind: 'plant', name: 'A', x: 0, y: 0, scaleCm: 30, rotDeg: 0, displacement: 0.9 },
      { id: 'p2', kind: 'plant', name: 'B', x: 0, y: 0, scaleCm: 40, rotDeg: 0 },
    ];
    expect(hardscapeDisplacementL(plants), '排水只统计 kind=hardscape，水草应被过滤').toBe(0);
  });

  it('只有一件大石：20cm 石 ×0.55 → 包围盒 3.92L × 0.55 = 2.156L', () => {
    const d = hardscapeDisplacementL([rock(20, 0.55)]);
    expect(d, '包围盒 = 20×(20×0.7)×(20×0.7)/1000 = 3.92L；×0.55 = 2.156L').toBeCloseTo(2.156, 9);
  });

  it('多件叠加：等于逐件单独计算之和，核心层保留全精度不取整', () => {
    const items = [rock(20, 0.55), wood(30, 0.3), rock(10)]; // 第三件用默认系数
    // 手工核算：2.156 + 13.23×0.3 + 0.49×0.55 = 2.156 + 3.969 + 0.2695 = 6.3945L
    const manual = 2.156 + 3.969 + 0.2695;
    const total = hardscapeDisplacementL(items);
    const sumOfSingles = items.reduce((s, it) => s + hardscapeDisplacementL([it]), 0);
    expect(total, '多件排水 = 逐件排水之和（累加顺序一致，应严格相等）').toBe(sumOfSingles);
    expect(total, '手工核算 2.156+3.969+0.2695 = 6.3945L；核心层不做取整，取整只发生在 UI 的 toFixed').toBeCloseTo(manual, 9);
  });

  it('未配置 displacement 时按 shape 取默认系数：石 0.55 / 木 0.3', () => {
    // 10cm 包围盒 = 10×7×7/1000 = 0.49L
    expect(hardscapeDisplacementL([rock(10)]), '石默认 0.55：0.49×0.55 = 0.2695L').toBeCloseTo(0.2695, 9);
    expect(hardscapeDisplacementL([wood(10)]), '木默认 0.3：0.49×0.3 = 0.147L').toBeCloseTo(0.147, 9);
  });
});

describe('厘米/毫米混用换算（缸体 cm，水面/厚度/坡度 mm，换算 ÷10）', () => {
  it('水面 390mm → 39cm：毛水量 105.3L（若漏 ÷10 会放大 10 倍成 1053L）', () => {
    const t = tank({ waterLevelMm: 390 });
    expect(waterHeightCm(t), '水面 390mm ÷10 = 39cm').toBeCloseTo(39, 9);
    expect(grossVolumeL(t), '毛水量 = 60×45×39/1000 = 105.3L，而非 1053L').toBeCloseTo(105.3, 9);
  });

  it('水面不足 1cm 的毫米值：5mm → 0.5cm', () => {
    expect(waterHeightCm(tank({ waterLevelMm: 5 })), '水面 5mm ÷10 = 0.5cm').toBeCloseTo(0.5, 9);
  });

  it('底砂厚度与坡度：50mm → 5cm，坡度 60mm 折半 → 3cm，合计 8cm', () => {
    const s = sub({ thicknessMm: 50, slopeMm: 60 });
    expect(substrateAvgThicknessCm(s), '平均厚度 = 50/10 + 60/10/2 = 5+3 = 8cm').toBeCloseTo(8, 9);
    expect(substrateVolumeL(tank(), s), '底砂体积 = 60×45×8/1000 = 21.6L').toBeCloseTo(21.6, 9);
  });

  it('坡度为奇数毫米：5mm 折半 → 0.25cm，不向毫米取整', () => {
    expect(substrateAvgThicknessCm(sub({ thicknessMm: 0, slopeMm: 5 })), '0 + 5/10/2 = 0.25cm').toBeCloseTo(0.25, 9);
  });
});

describe('水面面积零边界（算法：面积 = l×w/10000 m²）', () => {
  it('长为 0：面积为 0', () => {
    expect(waterSurfaceAreaM2(tank({ l: 0, w: 50 })), '0×50/10000 = 0').toBe(0);
  });

  it('宽为 0：面积为 0', () => {
    expect(waterSurfaceAreaM2(tank({ l: 100, w: 0 })), '100×0/10000 = 0').toBe(0);
  });

  it('长宽都为 0：面积为 0 且不抛错', () => {
    expect(waterSurfaceAreaM2(tank({ l: 0, w: 0 })), '0×0/10000 = 0').toBe(0);
  });
});
