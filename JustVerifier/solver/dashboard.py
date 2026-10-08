import html
import json
from pathlib import Path

import pandas as pd
import streamlit as st

ROOT = Path(__file__).resolve().parent.parent
SOLVER = ROOT / "solver"
EVIDENCE = ROOT / "evidence"

st.set_page_config(
    page_title="JustVerifier | Trusted Verification",
    page_icon="🛡️",
    layout="wide",
    initial_sidebar_state="expanded"
)

st.markdown("""
<style>
.block-container {
    max-width: 1320px;
    padding-top: 2rem;
    padding-bottom: 3rem;
}
[data-testid="stAppViewContainer"] {
    background: #f8fafc;
}
.hero {
    background: linear-gradient(115deg,#172554,#1d4ed8);
    color: white;
    border-radius: 18px;
    padding: 30px 34px;
    margin-bottom: 20px;
}
.hero h1 {
    font-size: 36px;
    margin: 0 0 8px 0;
    color: white;
}
.hero p {color: #dbeafe; margin: 0;}
.flow {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin: 18px 0 24px;
}
.step {
    background: white;
    border: 1px solid #dbe3ef;
    padding: 12px 15px;
    border-radius: 10px;
    font-size: 13px;
    color: #334155;
}
.schedule {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    background: white;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    overflow: hidden;
}
.schedule th {
    background: #eef2f7;
    color: #475569;
    text-align: center;
    padding: 14px;
    font-size: 13px;
}
.schedule td {
    padding: 18px 12px;
    text-align: center;
    border-top: 1px solid #e2e8f0;
    color: #334155;
    font-weight: 500;
}
.schedule td:first-child {
    font-weight: 700;
}
.schedule td.conflict {
    background: #fee2e2;
    color: #b91c1c;
    font-weight: 800;
}
.schedule td.changed {
    background: #dcfce7;
    color: #166534;
    font-weight: 800;
}
.schedule td.locked {
    background: #eff6ff;
}
.note {
    padding: 14px 18px;
    background: #eff6ff;
    border-left: 4px solid #2563eb;
    border-radius: 8px;
    color: #1e40af;
}
</style>
""", unsafe_allow_html=True)


def load(path):
    return json.loads(
        Path(path).read_text(encoding="utf-8")
    )


st.sidebar.title("JustVerifier")
st.sidebar.caption("Trusted Optimization Agent")
st.sidebar.divider()

case = st.sidebar.radio(
    "选择验证场景",
    ["正常修复", "恶意篡改"]
)

st.sidebar.divider()
st.sidebar.caption("Agnes 3.0 Flash + AGH")
st.sidebar.caption("OR-Tools CP-SAT")
st.sidebar.caption("Independent Audit")
st.sidebar.info(
    "当前为离线证据展示模式，"
    "不会实时调用 AGH。"
)

original = load(SOLVER / "demo.json")

if case == "正常修复":
    result = load(SOLVER / "demo-result.json")
    audit = load(EVIDENCE / "audit/normal.json")
else:
    result = load(SOLVER / "tampered-result.json")
    audit = load(EVIDENCE / "audit/tampered.json")

repaired = result["repaired_schedule"]
valid = audit["status"] == "PASS"


def schedule_html(data, baseline=None, detect_conflicts=False):
    days = data["days"]
    before_by_name = {}

    if baseline is not None:
        before_by_name = {
            e["name"]: e["shifts"]
            for e in baseline["employees"]
        }

    conflict_cells = set()

    if detect_conflicts:
        for employee in data["employees"]:
            shifts = employee["shifts"]
            for i in range(1, len(shifts)):
                if shifts[i-1] == "N" and shifts[i] == "M":
                    conflict_cells.add((employee["name"], i-1))
                    conflict_cells.add((employee["name"], i))

    out = ['<table class="schedule"><thead><tr>']
    out.append('<th>Employee</th>')

    for day in days:
        out.append(f"<th>{html.escape(str(day))}</th>")

    out.append("</tr></thead><tbody>")

    fixed = set(original.get("fixed_days", []))

    for employee in data["employees"]:
        name = employee["name"]

        out.append("<tr>")
        out.append(f"<td>{html.escape(str(name))}</td>")

        for i, shift in enumerate(employee["shifts"]):
            css = ""
            before = before_by_name.get(name)

            if before is not None and before[i] != shift:
                css = "changed"
            elif (name, i) in conflict_cells:
                css = "conflict"
            elif days[i] in fixed:
                css = "locked"

            out.append(
                f'<td class="{css}">'
                f'{html.escape(str(shift))}'
                '</td>'
            )

        out.append("</tr>")

    out.append("</tbody></table>")
    return "".join(out)


st.markdown("""
<div class="hero">
<h1>JustVerifier</h1>
<p>Counterexample-Guided Repair & Trusted Verification</p>
<p>Agnes · Agnes Harness · OR-Tools CP-SAT</p>
</div>
""", unsafe_allow_html=True)

st.info(
    "演示数据来自已保存的本地测试结果；"
    "实时 Agent 执行证据请在 AGH 轨迹页面查看。"
)

st.markdown("""
<div class="flow">
<div class="step">01 · Constraint Verification</div>
<div class="step">→ 02 · CP-SAT Repair</div>
<div class="step">→ 03 · Reverification</div>
<div class="step">→ 04 · Independent Audit</div>
</div>
""", unsafe_allow_html=True)

a, b, c, d = st.columns(4)

a.metric("CP-SAT 报告状态", result["status"])
b.metric("独立审计", audit["status"])
c.metric("实际修改数量", audit["changed_assignments"])
d.metric(
    "求解时间",
    f'{result.get("wall_time_seconds", 0)*1000:.2f} ms'
)

if valid:
    st.success("PASS · 修复候选方案通过独立审计")
else:
    st.error("FAIL · 候选方案未通过审计，拒绝接受")

tab1, tab2, tab3 = st.tabs([
    "排班与可信审计",
    "性能分析",
    "原始证据"
])

with tab1:
    st.subheader("01 · 排班修复对比")

    st.caption(
        "红色：原始违规班次 ｜ "
        "绿色：发生修改的单元格 ｜ "
        "浅蓝色：历史锁定班次"
    )

    left, right = st.columns(2, gap="large")

    with left:
        st.markdown("**Before · 原始排班**")
        st.markdown(
            schedule_html(original, detect_conflicts=True),
            unsafe_allow_html=True
        )

    with right:
        st.markdown("**After · 候选修复排班**")
        st.markdown(
            schedule_html(repaired, baseline=original),
            unsafe_allow_html=True
        )

    st.divider()
    st.subheader("02 · 修复与审计详情")

    left, right = st.columns(2)

    with left:
        st.markdown("**修改明细**")
        for old, new in zip(
            original["employees"], repaired["employees"]
        ):
            for day, a_shift, b_shift in zip(
                original["days"],
                old["shifts"],
                new["shifts"]
            ):
                if a_shift != b_shift:
                    st.write(
                        f"**{old['name']} · {day}**："
                        f"`{a_shift}` → `{b_shift}`"
                    )

    with right:
        st.markdown("**可信审计结果**")
        st.metric("Audit", audit["status"])
        st.write("检测到的违规：", len(audit["violations"]))

        if audit["violations"]:
            for item in audit["violations"]:
                st.error(item)
        else:
            st.success("当前审计规则下未发现违规")

    with st.expander("查看完整审计规则"):
        st.write(audit["checked_rules"])

with tab2:
    st.subheader("CP-SAT Benchmark")

    st.caption(
        "本地虚拟机 · 每种规模 3 个随机种子 · "
        "5 秒求解上限"
    )

    chart = EVIDENCE / "benchmarks/benchmark-performance.png"

    if chart.exists():
        st.image(str(chart), width=950)

    csv_path = EVIDENCE / "benchmarks/benchmark-results.csv"

    if csv_path.exists():
        df = pd.read_csv(csv_path)
        st.dataframe(df, use_container_width=True)

    st.warning(
        "图表仅表示本次生成实例的求解耗时，"
        "不构成多项式时间复杂度证明。"
    )

with tab3:
    st.subheader("可核查的本地测试证据")

    st.markdown("**CP-SAT 原始结果**")
    st.json(result)

    st.markdown("**独立审计原始结果**")
    st.json(audit)

    st.download_button(
        "下载本场景审计报告",
        data=json.dumps(audit, ensure_ascii=False, indent=2),
        file_name="justverifier-audit.json",
        mime="application/json"
    )

    st.info(
        "该下载文件是本地审计报告，"
        "不等同于 AGH 的原始工具执行轨迹。"
    )
