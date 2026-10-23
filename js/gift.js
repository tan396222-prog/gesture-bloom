/**
 * 给莱拉的 120 天 · 礼物配置
 * ------------------------------------------------------------------
 * 想改名字、天数、情话、信，只需要改这个文件，其他代码都不用动。
 * 文案里可以用 {name} 和 {days}，会被自动替换成名字和天数。
 */
export const GIFT = {
  /** 她的名字（中文）与英文写法 */
  name: '莱拉',
  nameEn: 'LAILA',

  /** 落款 */
  from: 'Tanlayla',

  /** 在一起的天数（startDate 为 null 时使用） */
  days: 120,

  /**
   * 在一起的第一天，例如 '2026-06-26'。
   * 填了之后天数会按今天的日期自动计算（第一天算作“第 1 天”），上面的 days 就不再使用。
   */
  startDate: null,

  /** 开场大标题 */
  headline: '我爱你，{name}',

  /** 开场副标题 */
  subline: '我们在一起的第 {days} 天',

  /**
   * 花开到盛放时浮现的一句话，每种花一句（键是花种 id，顺序同花园列表）。
   */
  lines: {
    peony:      '古人说芍药是离别的花，我偏要借它告诉你：我不走。',
    ranunculus: '洋牡丹一层一层地开，像我对你的喜欢，怎么也数不完。',
    tulip:      '郁金香是用来告白的花，那就再说一次：我喜欢你。',
    treepeony:  '牡丹开得再好看，也不及你朝我笑一下。',
    lotus:      '你在身边的时候，日子就像这朵荷花，安静又明亮。',
    rose:       '玫瑰是最直白的花，就像我想对你说的话：我爱你。',
    iris:       '鸢尾是信使之花，替我把这句话带给你：遇见你真好。',
    camellia:   '山茶落下时是一整朵的，我爱你，也想这样完整。',
  },

  /** 八种花都看过之后出现的信（也可以点右上角的 ♡ 打开） */
  letter: {
    eyebrow: 'DAY {days} · FOR {nameEn}',
    title: '给{name}',
    paragraphs: [
      '{name}：',
      '今天是我们在一起的第 {days} 天。我做了这座只在夜里开花的小花园，每一朵花都替我说了一句话，可我想对你说的，远比八句多。',
      '谢谢你走进我的生活，让很普通的日子也变得值得期待。以后的每一天，我都想认真地喜欢你，陪你看更多的花开，也陪你走过那些不太好的日子。',
      '第 {days} 天，只是开始。',
    ],
    sign: '爱你的 {from}',
  },

  /** 八种花都盛放过之后，是否自动打开信 */
  autoFinale: true,
};

/** 计算在一起的天数 */
export function giftDays(g = GIFT) {
  if (g.startDate) {
    const [y, m, d] = String(g.startDate).split(/[-/.]/).map(Number);
    const start = new Date(y, (m || 1) - 1, d || 1);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const n = Math.round((today - start) / 86400000) + 1;
    if (Number.isFinite(n) && n > 0) return n;
  }
  return g.days;
}

/** 替换文案里的 {name} {days} {from} {nameEn} */
export function fill(text, g = GIFT) {
  const days = giftDays(g);
  return String(text ?? '')
    .replace(/\{name\}/g, g.name)
    .replace(/\{nameEn\}/g, g.nameEn)
    .replace(/\{from\}/g, g.from)
    .replace(/\{days\}/g, days);
}
