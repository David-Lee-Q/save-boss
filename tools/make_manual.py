# -*- coding: utf-8 -*-
"""Generate 抢救老板_游戏说明书.docx from the game manual content."""
import os
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

ACCENT = RGBColor(0xC8, 0x7A, 0x24)
INK = RGBColor(0x1B, 0x1D, 0x20)
GREY = RGBColor(0x5A, 0x5F, 0x66)

doc = Document()

# page setup
for s in doc.sections:
    s.page_width = Cm(21.0)
    s.page_height = Cm(29.7)
    s.top_margin = Cm(2.4)
    s.bottom_margin = Cm(2.2)
    s.left_margin = Cm(2.4)
    s.right_margin = Cm(2.2)

# base styles
st = doc.styles['Normal']
st.font.name = 'Microsoft YaHei'
st.font.size = Pt(10.5)
st.font.color.rgb = INK
st.element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')
st.paragraph_format.line_spacing = 1.5
st.paragraph_format.space_after = Pt(4)


def shade(par, color):
    pPr = par._p.get_or_add_pPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), color)
    pPr.append(shd)


def heading(text, level=1, space_before=14):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(space_before)
    p.paragraph_format.space_after = Pt(6)
    p.paragraph_format.keep_with_next = True
    r = p.add_run(text)
    r.bold = True
    r.font.name = 'Microsoft YaHei'
    r._element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')
    r.font.color.rgb = INK if level > 1 else ACCENT
    r.font.size = Pt(15 if level == 1 else 12)
    if level == 1:
        pPr = p._p.get_or_add_pPr()
        borders = OxmlElement('w:pBdr')
        bottom = OxmlElement('w:bottom')
        bottom.set(qn('w:val'), 'single')
        bottom.set(qn('w:sz'), '10')
        bottom.set(qn('w:space'), '4')
        bottom.set(qn('w:color'), 'C87A24')
        borders.append(bottom)
        pPr.append(borders)
    return p


def para(text, size=10.5, color=INK, bold=False, space_after=4, align=None):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(space_after)
    if align is not None:
        p.alignment = align
    r = p.add_run(text)
    r.font.size = Pt(size)
    r.font.color.rgb = color
    r.bold = bold
    r.font.name = 'Microsoft YaHei'
    r._element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')
    return p


def bullet(text, size=10.5):
    p = doc.add_paragraph(style='List Bullet')
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.line_spacing = 1.4
    r = p.add_run(text)
    r.font.size = Pt(size)
    r.font.color.rgb = INK
    r.font.name = 'Microsoft YaHei'
    r._element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')
    return p


def mono(text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(6)
    p.paragraph_format.space_after = Pt(8)
    p.paragraph_format.line_spacing = 1.1
    shade(p, 'F3F0E9')
    r = p.add_run(text)
    r.font.name = 'Consolas'
    r._element.rPr.rFonts.set(qn('w:eastAsia'), '等线')
    r.font.size = Pt(7.6)
    return p


def table(headers, rows, widths=None):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = 'Table Grid'
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    hdr = t.rows[0].cells
    for i, h in enumerate(headers):
        hdr[i].text = ''
        p = hdr[i].paragraphs[0]
        r = p.add_run(h)
        r.bold = True
        r.font.size = Pt(9.5)
        r.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
        r.font.name = 'Microsoft YaHei'
        r._element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')
        shade(p, '3A3F45')
    for row in rows:
        cells = t.add_row().cells
        for i, v in enumerate(row):
            cells[i].text = ''
            p = cells[i].paragraphs[0]
            p.paragraph_format.space_after = Pt(1)
            r = p.add_run(str(v))
            r.font.size = Pt(9)
            r.font.name = 'Microsoft YaHei'
            r._element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')
    if widths:
        for i, w in enumerate(widths):
            for row in t.rows:
                row.cells[i].width = Cm(w)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return t


# ---------------------------------------------------------------- cover
p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.space_before = Pt(90)
r = p.add_run('抢救老板')
r.bold = True
r.font.size = Pt(46)
r.font.color.rgb = INK
r.font.name = 'Microsoft YaHei'
r._element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')

p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run('S A V E   T H E   B O S S')
r.font.size = Pt(12)
r.font.color.rgb = ACCENT
r.bold = True

p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.space_before = Pt(18)
r = p.add_run('室内第一人称战术射击 · 游戏说明书')
r.font.size = Pt(13)
r.font.color.rgb = GREY

p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.space_before = Pt(55)
r = p.add_run('几猫中心 · 42F')
r.font.size = Pt(22)
r.bold = True
r.font.color.rgb = ACCENT

p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run('V1.0   |   WebGL2   |   单文件可离线运行')
r.font.size = Pt(10)
r.font.color.rgb = GREY

p = doc.add_paragraph()
p.paragraph_format.space_before = Pt(120)
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run('— 请把老板活着带出来 —')
r.font.size = Pt(11)
r.font.color.rgb = GREY
r.italic = True

doc.add_page_break()

# ---------------------------------------------------------------- 1
heading('1  故事背景')
para('22:47，几猫中心 42 层的下班时间。')
para('一伙持械人员从货梯进入楼层，切断了门禁与监控，控制了前台、员工区与两间高管办公室。电梯被锁定在本层，手机信号被屏蔽。')
para('你是当晚值班的危机响应人员，随身只有一把执勤卡宾枪。楼层里有 10 名劫匪、5 名没能离开的同事，以及被困在 CEO 办公室的创始人陈立群。')
para('你的任务：清剿全部劫匪，找到老板。', bold=True)

heading('2  安装与运行')
heading('2.1  直接运行', 2)
para('1. 取得 index.html（仓库根目录，约 0.9 MB，已内联全部资源）。')
para('2. 双击，或用 Chrome / Edge / Safari 打开。')
para('3. 等待载入条走完，进入标题界面。')
para('4. 点击「进入 42 层」，再点击画面锁定鼠标。')
para('也可以通过本地静态服务器访问：python -m http.server 8080，然后打开 http://localhost:8080/。', color=GREY, size=9.5)

heading('2.2  运行要求', 2)
bullet('支持 WebGL2 的现代浏览器；桌面端建议 1080p 分辨率。')
bullet('需要硬件加速。若帧率偏低，请在设置中把画面质量调为「流畅」。')
bullet('浏览器要求首次点击后才能播放声音（自动播放策略）。')

# ---------------------------------------------------------------- 3 controls
heading('3  操作说明')
heading('3.1  键盘 / 鼠标', 2)
table(['功能', '按键'], [
    ['移动', 'W / A / S / D（或方向键）'],
    ['转动视角', '移动鼠标（点击画面锁定指针）'],
    ['开火', '鼠标左键'],
    ['瞄准（ADS）', '鼠标右键'],
    ['换弹', 'R'],
    ['交互 / 营救（按住）', 'E'],
    ['近战', 'F'],
    ['跳跃 / 冲刺 / 蹲伏', 'Space / Shift / C（或 Ctrl）'],
    ['静音 / 暂停', 'M / Esc 或 P'],
], widths=[6.0, 8.6])
para('提示：若浏览器未能锁定鼠标，按住左键拖动也可以转动视角（同时会开火）。冲刺会放大视野、降低精度，并让附近敌人听见脚步。', color=GREY, size=9.5)

heading('3.2  触屏', 2)
bullet('左半屏滑动：移动（虚拟摇杆）。')
bullet('右半屏拖动：视角。')
bullet('右下按钮：开火、瞄准、跳跃、换弹、交互、暂停。')
bullet('靠近人质 / 老板后按住「交互」完成营救。')

# ---------------------------------------------------------------- 4 HUD
doc.add_page_break()
heading('4  HUD 说明')
table(['区域', '内容'], [
    ['顶部罗盘', '方位刻度（北 000° 起），已发现房间的目标标记与剩余敌人数'],
    ['左上目标栏', '当前目标、剩余劫匪数、五个房间的搜索状态（未搜索 / 击杀进度 / 已清空）'],
    ['中央准星', '动态扩散，移动 / 连射时张开；开镜时隐藏'],
    ['命中反馈', '白色命中、橙色爆头、红色击杀；命中时伴随音效'],
    ['受击方向', '屏幕中心的红色弧线，指向伤害来源'],
    ['右下弹药', '弹匣余弹、备弹、弹匣格、当前武器；空仓与低弹量提示'],
    ['左下生命', '仅在受伤后显示；低于 30 时变红并有心跳声'],
    ['交互提示', '圆形进度环 + 按键 + 动作名（营救 / 解绑 / 先清剿全部劫匪）'],
    ['屏幕下方', '无线电字幕（队长、老板、人质）与系统提示'],
    ['右侧播报', '击倒 / 爆头记录'],
], widths=[3.6, 11.0])
para('进入新房间时，画面左下会显示房间名与英文标识。', color=GREY, size=9.5)

heading('5  楼层平面')
mono(
"""                       北（落地窗 · 城市夜景）
   ┌──────────────────┬───────────────────┬──────────────────┐
   │                  │                   │                  │
   │   CFO 办公室      │     会议室         │   CEO 办公室      │
   │   财务总监 高维    │   项目经理 周敏     │   老板 陈立群      │
   │   ● ● 劫匪 ×2     │   ● ● 劫匪 ×2      │   ● ● 劫匪 ×2      │
   │                  │                   │                  │
   ├──────────────────┴───────────────────┴──────────────────┤
   │                      环形走廊（北 / 东 / 西）              │
   ├──────────────────────────────┬──────────────────────────┤
   │                              │                          │
   │      员工办公大厅              │        茶水间             │
   │      前台 林小满               │   实习生 许安              │
   │      ● ● ● 劫匪 ×3            │        ● 劫匪 ×1          │
   │                              │                          │
   ├──────────────────────────────┴──────────────────────────┤
   │              前台大堂 · 电梯厅（玩家出生点）                │
   └──────────────────────────────────────────────────────────┘
                       南（石材核心筒 · 电梯）""")
bullet('楼层外圈为玻璃幕墙，可看到城市夜景；玻璃不可穿越。')
bullet('房间之间通过门洞与环形走廊连通；CEO / CFO 办公室的门在走廊两侧。')
bullet('会议室与 CFO 办公室为玻璃隔断，可获得视野但无法穿行。')
bullet('前台大堂南侧是电梯核心筒（已停用），也是出生点。')

# ---------------------------------------------------------------- 6 rooms
heading('6  房间与 NPC')
table(['房间', '面积（约）', '劫匪', 'NPC', '场景要点'], [
    ['前台大堂', '21.5 × 9.5 m', '0', '—', '大理石地面、接待台、背光 Logo 墙、电梯门、闸机'],
    ['员工办公大厅', '18 × 18 m', '3', '林小满 · 前台', '成组工位、显示器、白板、打印区、绿植'],
    ['会议室', '25 × 9.5 m', '2', '周敏 · 项目经理', '长会议桌、10 把座椅、投影屏、吊灯、白板'],
    ['CFO 办公室', '13.5 × 18 m', '2', '高维 · 财务总监', '双屏办公桌、档案柜、保险柜、软木公告板'],
    ['CEO 办公室', '13.5 × 18 m', '2', '陈立群 · 老板', '行政大班台、会客沙发、书墙、保险柜、艺术画'],
    ['茶水间', '17 × 9.5 m', '1', '许安 · 实习生', '吧台、咖啡机、冰箱、饮水机、岛台与高脚凳'],
], widths=[3.4, 2.9, 1.3, 3.1, 5.0])

heading('6.1  NPC 互动', 2)
bullet('靠近人质后按住 E 约 1.5 秒即可解开束缚。')
bullet('获救的人质会自行沿安全路线跑向前台大堂，并从场景中离开。')
bullet('人质会提供口头线索，但不会参与战斗。')
bullet('老板被绑在 CEO 办公室的座椅上。清空全部劫匪前，靠近只会得到「先清剿全部劫匪」的提示；清空后再按住 E 约 2 秒即可完成营救并结算。')

# ---------------------------------------------------------------- 7 combat
doc.add_page_break()
heading('7  战斗系统')
heading('7.1  玩家武器：MK-9 卡宾枪', 2)
table(['属性', '数值'], [
    ['弹匣 / 备弹', '30 / 210'],
    ['射速', '640 RPM（全自动）'],
    ['身体伤害', '34（约 3 发击倒）'],
    ['爆头倍率', '×2.6（约 2 发）'],
    ['换弹时间', '1.85 s'],
    ['腰射散布 / 开镜散布', '约 0.9° / 约 0.2°'],
    ['后坐', '连续射击累积上跳与散布，停火后回复'],
], widths=[6.6, 8.0])
para('近战：F，造成 55 点伤害，范围约 1.9 m。')

heading('7.2  生命与补给', 2)
bullet('初始生命 100，不会自动回复。')
bullet('医疗包：+35 HP；弹药箱：+60 发备弹。')
bullet('生命低于 30 时屏幕泛红、出现心跳声。')

heading('7.3  劫匪行为', 2)
bullet('巡逻：在各自房间内小范围走动。')
bullet('视觉：约 30 m 视野、受墙体遮挡；正面对视才会立即发现你。')
bullet('听觉：枪声会惊动附近劫匪；冲刺脚步在近距离也会暴露位置。')
bullet('交战：保持距离、左右侧移、短点射；命中率随距离和你自身移动速度下降。')
bullet('受击：中弹后立刻转入交战并朝你的方向搜索。')

heading('7.4  战术建议', 2)
bullet('先清理距离门口最近的敌人，避免被两侧夹击。')
bullet('会议室与茶水间空间开阔，利用长桌、岛台与门框做掩体。')
bullet('听到劫匪互相呼喊说明附近有人；先停步观察再推进。')
bullet('保留医疗包：CEO 办公室的两位劫匪会守在老板两侧。')
bullet('罗盘只显示「已搜索过」的房间；未知房间需要亲自推进。')

# ---------------------------------------------------------------- 8 flow
heading('8  任务流程')
para('1. 入场：从前台大堂出发，熟悉罗盘与目标栏。')
para('2. 搜索：沿环形走廊推进，逐一进入五个房间。')
para('3. 清剿：击倒全部 10 名劫匪；目标栏会实时更新每个房间的进度。')
para('4. 营救：全部清空后，罗盘与目标栏指向 CEO 办公室；靠近老板按住 E。')
para('5. 结算：显示用时、命中率、击倒数、救出人质数、各房间状态与行动评级。')
para('评级参考：命中率、用时与人质救援数量。S 级需要较高命中率、较快节奏，并救出多数人质。', color=GREY, size=9.5)
para('失败条件：生命值归零。死亡界面可重新进入，重试次数记录在结算中。')

# ---------------------------------------------------------------- 9 settings
heading('9  设置')
table(['项目', '说明'], [
    ['画面质量', '流畅 / 均衡 / 精细：影响分辨率倍率、Bloom 与阴影开销'],
    ['鼠标灵敏度', '0.20 – 2.40'],
    ['反转垂直视角', '开 / 关'],
    ['主音量', '0 – 100%（含环境音与音效）'],
    ['视野范围', '60° – 100°（默认 82°，开镜自动收缩到 52°）'],
], widths=[3.8, 10.8])
para('设置会保存在浏览器本地存储中，下次打开自动恢复。', color=GREY, size=9.5)

# ---------------------------------------------------------------- 10 perf
heading('10  性能与兼容性')
bullet('使用自定义 HDR 后处理（Bloom + ACES + 暗角 + 颗粒）。低端设备建议「流畅」。')
bullet('若帧率持续低于约 42 FPS，游戏会自动下调渲染分辨率；帧率恢复后逐步回升。')
bullet('移动端建议横屏；触屏按钮会占据屏幕右下角。')
bullet('声音需要首次点击后才会启用；M 键可随时静音。')

# ---------------------------------------------------------------- 11 faq
heading('11  常见问题')
faq = [
    ('提示「先清剿全部劫匪」？', '老板在清场前不会离开。查看左上目标栏，逐个房间确认击杀进度。'),
    ('找不到某个房间？', '未进入过的房间在清单里显示为「未搜索」。沿环形走廊走一圈，门上的房间标识牌会指引方向。'),
    ('没有声音？', '先点击画面任意位置（浏览器策略要求用户手势）。再检查是否按到了 M 静音。'),
    ('鼠标不能转视角？', '点击画面请求指针锁定；若浏览器拒绝，可按住鼠标左键拖动视角。'),
    ('画面很卡？', '设置中切换到「流畅」，并确保浏览器开启硬件加速。'),
]
for q, a in faq:
    para(q, bold=True, space_after=1)
    para(a, color=GREY, size=9.5, space_after=6)

# ---------------------------------------------------------------- 12 tech
heading('12  技术说明（开发者）')
bullet('单文件构建：node src/build.js 将 CSS、three.js r160、全部游戏脚本内联为 index.html。')
bullet('纹理、城市天际线、界面标识全部由 Canvas 2D 程序化生成，无外部素材。')
bullet('音效由 WebAudio 实时合成（噪声明弹、滤波、包络），无音频文件。')
bullet('关卡采用 52 × 44 m 的单层平面、AABB 碰撞与 0.7 m 导航网格 A*；劫匪按网格寻路并做视线检测。')
bullet('渲染：HDR 半浮点渲染目标 + 亮度提取 + 两级高斯模糊 + ACES 色调映射 + 暗角 / 颗粒 / 色差合成。')
bullet('主要模块：level.js（场景与导航）、npc.js（角色与 AI）、weapon.js（武器与命中特效）、hud.js（界面）、game.js（流程与输入）。')

p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.space_before = Pt(26)
r = p.add_run('《抢救老板》V1.0 — 几猫中心 42F。玩得开心，记得把老板带出来。')
r.font.size = Pt(10)
r.font.color.rgb = GREY
r.italic = True

out = os.path.join(os.path.dirname(__file__), '..', '抢救老板_游戏说明书.docx')
doc.save(out)
print('wrote', os.path.abspath(out))
