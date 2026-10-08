import csv
import json
import math
import random
import subprocess
import time
from pathlib import Path

from cp_sat_repair import solve_schedule

ROOT = Path(__file__).resolve().parent
OUT = ROOT.parent / "evidence" / "benchmarks"
OUT.mkdir(parents=True, exist_ok=True)

SCALES = [(5, 7), (10, 14), (20, 21), (40, 28)]
SEEDS = [42, 123, 2026]


def generate(staff, duration, seed):
    rng = random.Random(seed)
    days = [f"D{i+1:02d}" for i in range(duration)]
    employees = [
        {"name": f"E{i:02d}", "shifts": ["OFF"] * duration}
        for i in range(staff)
    ]

    # 先构造一个满足约束的参考排班
    for d in range(duration):
        employees[d % staff]["shifts"][d] = "M"
        employees[(d + 1) % staff]["shifts"][d] = "D"
        employees[(d + 3) % staff]["shifts"][d] = "N"

    # 在非锁定日期删除部分早班，制造缺岗反例
    candidates = list(range(2, duration))
    chosen = rng.sample(
        candidates,
        min(len(candidates), max(1, duration // 4))
    )

    for d in chosen:
        employees[d % staff]["shifts"][d] = "OFF"

    return {
        "days": days,
        "employees": employees,
        "coverage_requirements": {
            day: {"M": 1, "D": 1, "N": 1}
            for day in days
        },
        "fixed_days": days[:2],
        "max_consecutive_days": 4,
        "max_night_shifts": math.ceil(duration / staff) + 1
    }


records = []

for staff, duration in SCALES:
    for seed in SEEDS:
        name = f"n{staff}_d{duration}_s{seed}"

        problem = generate(staff, duration, seed)

        input_path = OUT / f"{name}-input.json"
        result_path = OUT / f"{name}-result.json"

        input_path.write_text(json.dumps(problem, indent=2))

        start = time.perf_counter()
        result = solve_schedule(problem, time_limit=5.0)
        elapsed = (time.perf_counter() - start) * 1000

        result_path.write_text(json.dumps(result, indent=2))

        audit = "NOT_RUN"

        if result["status"] in ("OPTIMAL", "FEASIBLE"):
            try:
                proc = subprocess.run(
                    [
                        "node",
                        str(ROOT / "verify_candidate.mjs"),
                        str(input_path),
                        str(result_path)
                    ],
                    capture_output=True,
                    text=True,
                    timeout=15
                )
                report = json.loads(proc.stdout)
                audit = report.get("status", "ERROR")
                if proc.returncode != 0:
                    audit = "FAIL"
            except Exception:
                audit = "ERROR"

        row = {
            "employees": staff,
            "days": duration,
            "seed": seed,
            "status": result["status"],
            "solver_ms": round(
                result["wall_time_seconds"] * 1000, 3
            ),
            "total_solver_call_ms": round(elapsed, 3),
            "changed_assignments":
                result.get("changed_assignments", ""),
            "audit": audit
        }

        records.append(row)

        print(
            f"{name}: {row['status']}, "
            f"{row['total_solver_call_ms']} ms, "
            f"audit={audit}"
        )

csv_path = OUT / "benchmark-results.csv"

with csv_path.open("w", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=records[0].keys())
    writer.writeheader()
    writer.writerows(records)

print(f"\n测试完成：{len(records)} 组")
print(f"结果已保存：{csv_path}")
