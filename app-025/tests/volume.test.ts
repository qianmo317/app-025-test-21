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

/**
 * 诊断辅助：定位把有效水量压到 0 的扣减项。
 * 仅扣底砂后余额 ≤ 0 → 底砂单独即可压零；否则是素材排水补足压零。
 */
function zeroDriver(gross: number, subVol: number, displace: number): '未被压零' | '底砂' | '素材排水' {
  if (gross - subVol - displace > 0) return '未被压零';
  return gross - subVol <= 0 ? '底砂' : '素材排水';
}

describe('毛水量边界：水面高度与缸高的关系', () => {
  // 算法：水柱高(cm) = max(0, min(缸高h, 水面mm/10))；毛水量(L) = l × w × 水柱高 / 1000
  it('水面正好等于缸高：水柱 = 缸高，毛水量 = 满缸 121.5L', () => {
    const t = tank({ h: 45, waterLevelMm: 450 });
    expect(waterHeightCm(t), '第1步 waterHeightCm：450mm/10=45，min(45,45)=45').toBe(45);
    expect(grossVolumeL(t), '第2步 grossVolumeL = 60×45×45/1000 = 121.5').toBeCloseTo(121.5, 9);
  });

  it('水面超过缸高：被缸高夹取，毛水量仍等于满缸（不溢出）', () => {
    const t = tank({ h: 45, waterLevelMm: 600 });
    expect(waterHeightCm(t), '第1步 waterHeightCm：600mm/10=60，被缸高夹取为 45').toBe(45);
    expect(grossVolumeL(t), '第2步 grossVolumeL = 60×45×45/1000 = 121.5（与满缸相同）').toBeCloseTo(121.5, 9);
  });

  it('水面为零：水柱为 0，毛水量为 0', () => {
    const t = tank({ waterLevelMm: 0 });
    expect(waterHeightCm(t), '第1步 waterHeightCm：0mm → 0cm').toBe(0);
    expect(grossVolumeL(t), '第2步 grossVolumeL = 60×45×0/1000 = 0').toBe(0);
  });

  it('水面为负：被 0 夹取，毛水量为 0（不出现负水量）', () => {
    const t = tank({ waterLevelMm: -100 });
    expect(waterHeightCm(t), '第1步 waterHeightCm：-100mm/10=-10，max(0,-10)=0').toBe(0);
    expect(grossVolumeL(t), '第2步 grossVolumeL = 0（下限夹取）').toBe(0);
  });
});

describe('有效水量边界：底砂为零 / 负坡度 / 底砂超过水柱', () => {
  // 算法：有效水量 = max(0, 毛水量 − 底砂体积 − 素材排水)；底砂平均厚度 = max(0, 厚度mm/10 + 坡度mm/10/2)
  it('厚度与坡度都为零：底砂体积为 0，有效水量 = 毛水量', () => {
    const t = tank(); // 60×45，水面 390mm → 水柱 39cm，毛水量 105.3L
    const s = sub({ thicknessMm: 0, slopeMm: 0 });
    expect(substrateAvgThicknessCm(s), '第1步 平均厚度 = max(0, 0+0) = 0').toBe(0);
    expect(substrateVolumeL(t, s), '第2步 底砂体积 = 60×45×0/1000 = 0').toBe(0);
    expect(effectiveVolumeL(t, s, []), '第3步 有效水量 = 105.3 − 0 − 0 = 105.3').toBeCloseTo(105.3, 9);
    expect(effectiveVolumeL(t, s, []), '第3步 无任何扣减时有效水量等于毛水量').toBe(grossVolumeL(t));
  });

  it('坡度为负：平均厚度 = 基础 + 坡度/2（负坡度拉低均值）', () => {
    const s = sub({ thicknessMm: 50, slopeMm: -40 });
    expect(substrateAvgThicknessCm(s), '第1步 平均厚度 = 50/10 + (−40)/10/2 = 5 − 2 = 3').toBe(3);
    expect(substrateVolumeL(tank(), s), '第2步 底砂体积 = 60×45×3/1000 = 8.1').toBeCloseTo(8.1, 9);
  });

  it('负坡度超过 2×厚度：平均厚度被夹取为 0（对总和夹取，非逐项）', () => {
    const t = tank();
    const s = sub({ thicknessMm: 30, slopeMm: -100 });
    expect(substrateAvgThicknessCm(s), '第1步 平均厚度 = max(0, 3 − 5) = 0').toBe(0);
    expect(substrateVolumeL(t, s), '第2步 底砂体积 = 0').toBe(0);
    expect(effectiveVolumeL(t, s, []), '第3步 有效水量 = 毛水量（底砂不扣减）').toBe(grossVolumeL(t));
  });

  it('底砂平均厚度超过水柱高度：有效水量被压到 0，压零项是底砂', () => {
    const t = tank({ l: 40, w: 30, h: 30, waterLevelMm: 300 }); // 水柱 30cm，毛水量 36L
    const s = sub({ thicknessMm: 300, slopeMm: 100 }); // 平均 35cm > 水柱 30cm
    const gross = grossVolumeL(t);
    const subVol = substrateVolumeL(t, s);
    expect(gross, '前提 毛水量 = 40×30×30/1000 = 36').toBe(36);
    expect(substrateAvgThicknessCm(s), '前提 平均厚度 = 300/10 + 100/10/2 = 35cm > 水柱 30cm').toBe(35);
    expect(subVol, '前提 底砂体积 = 40×30×35/1000 = 42 > 毛水量 36').toBe(42);
    expect(gross - subVol, '诊断：仅底砂一项已使余额为负（36 − 42 = −6）').toBeLessThan(0);
    expect(effectiveVolumeL(t, s, []), '第4步 有效水量 = max(0, −6) = 0').toBe(0);
    expect(zeroDriver(gross, subVol, 0), '诊断：压零项').toBe('底砂');
  });

  it('底砂不足以压零、素材排水补足：压零项是素材排水', () => {
    const t = tank({ l: 40, w: 30, h: 30, waterLevelMm: 300 }); // 毛水量 36L
    const s = sub({ thicknessMm: 200, slopeMm: 0 }); // 平均 20cm → 底砂 24L
    const rock: Item = { id: 'r1', kind: 'hardscape', name: '大石', x: 5, y: 5, scaleCm: 40, rotDeg: 0, displacement: 0.55, shape: 'rock' };
    const gross = grossVolumeL(t);
    const subVol = substrateVolumeL(t, s);
    const displace = hardscapeDisplacementL([rock]);
    expect(subVol, '前提 底砂体积 = 40×30×20/1000 = 24').toBe(24);
    expect(gross - subVol, '诊断：扣除底砂后余额仍为正（36 − 24 = 12）').toBe(12);
    expect(displace, '前提 素材排水 = (28×28×40/1000)×0.55 = 17.248 > 余额 12').toBeCloseTo(17.248, 9);
    expect(effectiveVolumeL(t, s, [rock]), '第4步 有效水量 = max(0, 12 − 17.248) = 0').toBe(0);
    expect(zeroDriver(gross, subVol, displace), '诊断：压零项').toBe('素材排水');
  });
});

describe('硬景观排水体积：累加与取整', () => {
  // 算法：仅 kind='hardscape' 计入；单件 = (尺寸×0.7)²×尺寸/1000 × 排水系数
  // 系数：displacement 可配，缺省按 shape（wood 0.3 / 其他 0.55）；本层不取整，取整在下游（equipment/bom）
  const rock = (scaleCm: number, p: Partial<Item> = {}): Item => ({
    id: `r${scaleCm}`, kind: 'hardscape', name: '石', x: 0, y: 0, scaleCm, rotDeg: 0, shape: 'rock', ...p,
  });

  it('空清单：排水体积为 0', () => {
    expect(hardscapeDisplacementL([]), '无素材 → 0').toBe(0);
  });

  it('只有一件大石：包围盒 × 默认石系数 0.55，结果不取整', () => {
    // 30cm 石：包围盒 (30×0.7)²×30/1000 = 13.23L，×0.55 = 7.2765L
    const d = hardscapeDisplacementL([rock(30)]);
    expect(d, '单件排水 = 13.23 × 0.55 = 7.2765').toBeCloseTo(7.2765, 9);
    expect(d % 1, '本层不取整：结果保留小数（取整发生在 equipment/bom 下游）').not.toBe(0);
  });

  it('多件叠加：总排水 = 各件之和（石 + 木 + 自定义系数）', () => {
    const items = [rock(20), { ...rock(25), shape: 'wood' as const }, rock(15, { displacement: 0.4 })];
    // 石20：3.92 × 0.55 = 2.156；木25：7.65625 × 0.3 = 2.296875；石15(自定义0.4)：1.65375 × 0.4 = 0.6615
    const total = hardscapeDisplacementL(items);
    expect(total, '累加 = 2.156 + 2.296875 + 0.6615 = 5.114375').toBeCloseTo(5.114375, 9);
    expect(total, '累加性：整体之和 = 单件分别计算再相加').toBeCloseTo(
      hardscapeDisplacementL([items[0]]) + hardscapeDisplacementL([items[1]]) + hardscapeDisplacementL([items[2]]),
      12,
    );
  });

  it('缺省系数按 shape：木 0.3、石 0.55；自定义 displacement 覆盖 shape', () => {
    const bbox = (10 * 0.7 * 10 * 0.7 * 10) / 1000; // 10cm 件包围盒 = 0.49L
    const wood = hardscapeDisplacementL([{ ...rock(10), shape: 'wood' as const }]);
    const stone = hardscapeDisplacementL([rock(10)]);
    const custom = hardscapeDisplacementL([rock(10, { displacement: 0.5, shape: 'wood' })]);
    expect(wood, '木：0.49 × 0.3 = 0.147').toBeCloseTo(bbox * 0.3, 12);
    expect(stone, '石：0.49 × 0.55 = 0.2695').toBeCloseTo(bbox * 0.55, 12);
    expect(custom, '自定义 0.5 覆盖木 0.3：0.49 × 0.5 = 0.245').toBeCloseTo(bbox * 0.5, 12);
  });

  it('混排清单：水草不贡献排水，总量等于仅硬景观之和', () => {
    const plant: Item = { id: 'p1', kind: 'plant', name: '草', x: 0, y: 0, scaleCm: 40, rotDeg: 0, qty: 10 };
    expect(hardscapeDisplacementL([plant, rock(20)]), '混排 = 仅石20 的排水（水草被过滤）').toBeCloseTo(
      hardscapeDisplacementL([rock(20)]),
      12,
    );
  });
});

describe('单位换算：缸体 cm × 水位/厚度 mm', () => {
  // 换算：水面高度 mm÷10 → cm；厚度 mm÷10 → cm；坡度 mm÷10÷2 计入平均厚度
  it('水面 445mm → 44.5cm（÷10 换算，未被 45cm 缸高夹取）', () => {
    const t = tank({ h: 45, waterLevelMm: 445 });
    expect(waterHeightCm(t), '第1步 445mm ÷ 10 = 44.5cm').toBe(44.5);
    expect(grossVolumeL(t), '第2步 毛水量 = 60×45×44.5/1000 = 120.15').toBeCloseTo(120.15, 9);
  });

  it('水面 5mm → 0.5cm（小水位同样按 ÷10 换算）', () => {
    const t = tank({ waterLevelMm: 5 });
    expect(waterHeightCm(t), '第1步 5mm ÷ 10 = 0.5cm').toBe(0.5);
    expect(grossVolumeL(t), '第2步 毛水量 = 60×45×0.5/1000 = 1.35').toBeCloseTo(1.35, 9);
  });

  it('厚度 55mm + 坡度 30mm → 平均 5.5 + 1.5 = 7cm', () => {
    const s = sub({ thicknessMm: 55, slopeMm: 30 });
    expect(substrateAvgThicknessCm(s), '第1步 55/10 + 30/10/2 = 5.5 + 1.5 = 7').toBe(7);
    expect(substrateVolumeL(tank(), s), '第2步 底砂体积 = 60×45×7/1000 = 18.9').toBeCloseTo(18.9, 9);
  });

  it('厚度 1mm → 0.1cm（毫米级精度不丢失）', () => {
    const s = sub({ thicknessMm: 1, slopeMm: 0 });
    expect(substrateAvgThicknessCm(s), '第1步 1mm ÷ 10 = 0.1cm').toBeCloseTo(0.1, 12);
    expect(substrateVolumeL(tank(), s), '第2步 底砂体积 = 60×45×0.1/1000 = 0.27').toBeCloseTo(0.27, 9);
  });

  it('仅坡度 10mm（厚度为 0）→ 平均 0.5cm', () => {
    expect(substrateAvgThicknessCm(sub({ thicknessMm: 0, slopeMm: 10 })), '0 + 10/10/2 = 0.5').toBe(0.5);
  });
});

describe('水面面积边界：长或宽为零', () => {
  // 算法：面积(m²) = l × w / 10000
  it('长为 0：面积为 0', () => {
    expect(waterSurfaceAreaM2(tank({ l: 0, w: 45 })), '0×45/10000 = 0').toBe(0);
  });

  it('宽为 0：面积为 0', () => {
    expect(waterSurfaceAreaM2(tank({ l: 60, w: 0 })), '60×0/10000 = 0').toBe(0);
  });

  it('长宽都为 0：面积为 0', () => {
    expect(waterSurfaceAreaM2(tank({ l: 0, w: 0 })), '0×0/10000 = 0').toBe(0);
  });

  it('正常缸体锚点：60×45 → 0.27m²', () => {
    expect(waterSurfaceAreaM2(tank()), '60×45/10000 = 0.27').toBeCloseTo(0.27, 12);
  });
});
