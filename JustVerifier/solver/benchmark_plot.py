import csv
import statistics
from collections import defaultdict
from pathlib import Path
import matplotlib.pyplot as plt

root = Path(__file__).resolve().parent.parent / "evidence/benchmarks"
groups = defaultdict(list)

with (root / "benchmark-results.csv").open() as f:
    for row in csv.DictReader(f):
        key = (int(row["employees"]), int(row["days"]))
        groups[key].append(row)

labels, means, deviations = [], [], []

for (staff, days), rows in sorted(groups.items()):
    times = [float(r["solver_ms"]) for r in rows]
    labels.append(f"{staff} staff / {days} days")
    means.append(statistics.mean(times))
    deviations.append(statistics.stdev(times))

    print(
        f"{staff} staff x {days} days: "
        f"mean={means[-1]:.2f}ms, "
        f"std={deviations[-1]:.2f}ms"
    )

fig, ax = plt.subplots(figsize=(10, 5.5))
bars = ax.bar(
    labels, means,
    yerr=deviations,
    capsize=5
)

ax.bar_label(bars, fmt="%.1f", padding=5)
ax.set_ylabel("Solver time (ms)")
ax.set_title("JustVerifier CP-SAT Benchmark")
ax.set_ylim(bottom=0)
ax.grid(axis="y", alpha=0.2)

fig.text(
    0.5, 0.02,
    "3 seeds per scale | CP-SAT 5s limit | Local VM",
    ha="center", fontsize=9
)

fig.tight_layout(rect=[0, 0.05, 1, 1])
out = root / "benchmark-performance.png"
fig.savefig(out, dpi=220, bbox_inches="tight")
print("Chart saved:", out)
