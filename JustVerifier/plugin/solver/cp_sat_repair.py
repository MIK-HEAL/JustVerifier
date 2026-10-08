import json
import sys
from copy import deepcopy
from ortools.sat.python import cp_model

SHIFTS = ("M", "D", "N", "OFF")
WORK = ("M", "D", "N")


def solve_schedule(data, time_limit=5.0):
    days = data["days"]
    employees = data["employees"]

    if not 2 <= len(days) <= 31 or len(days) != len(set(days)):
        raise ValueError("日期数量或唯一性不合法")

    if not 1 <= len(employees) <= 50:
        raise ValueError("员工数量不合法")

    names = [e["name"] for e in employees]

    if len(set(names)) != len(names):
        raise ValueError("员工名称重复")

    for e in employees:
        if len(e["shifts"]) != len(days):
            raise ValueError("班次与日期长度不一致")
        if any(s not in SHIFTS for s in e["shifts"]):
            raise ValueError("存在非法班次")

    coverage = data.get("coverage_requirements", {})
    fixed_days = set(data.get("fixed_days", []))
    unavailable = data.get("unavailable", {})
    max_consecutive = data.get(
        "max_consecutive_days", len(days)
    )
    max_nights = data.get("max_night_shifts")

    if not fixed_days.issubset(set(days)):
        raise ValueError("固定日期不存在")

    if not isinstance(max_consecutive, int) or not 0 <= max_consecutive <= len(days):
        raise ValueError("max_consecutive_days 不合法")

    if max_nights is not None:
        if not isinstance(max_nights, int) or max_nights < 0:
            raise ValueError("max_night_shifts 不合法")

    model = cp_model.CpModel()
    n = len(employees)
    d_count = len(days)

    x = {}

    # 每个员工、每天、每个班次建立布尔变量
    for i in range(n):
        for d in range(d_count):
            for s in SHIFTS:
                x[i, d, s] = model.NewBoolVar(
                    f"x_{i}_{d}_{s}"
                )

    # C1：每人每天恰好一种状态
    for i in range(n):
        for d in range(d_count):
            model.Add(
                sum(x[i, d, s] for s in SHIFTS) == 1
            )

    # C2：夜班后禁止直接接早班
    for i in range(n):
        for d in range(d_count - 1):
            model.Add(
                x[i, d, "N"] + x[i, d + 1, "M"] <= 1
            )

    # C3：最低班次覆盖
    for day, requirements in coverage.items():
        if day not in days:
            raise ValueError(f"未知日期: {day}")

        d = days.index(day)

        for shift, minimum in requirements.items():
            if shift not in WORK:
                raise ValueError("覆盖约束包含非法班次")
            if not isinstance(minimum, int) or minimum < 0:
                raise ValueError("最低人数不合法")

            model.Add(
                sum(x[i, d, shift] for i in range(n))
                >= minimum
            )

    # C4：锁定已经发生的排班
    for d, day in enumerate(days):
        if day in fixed_days:
            for i, employee in enumerate(employees):
                original = employee["shifts"][d]
                model.Add(x[i, d, original] == 1)

    # C5：员工不可用日期
    for name, blocked_days in unavailable.items():
        if name not in names:
            raise ValueError(f"未知员工: {name}")

        i = names.index(name)

        for day in blocked_days:
            if day not in days:
                raise ValueError(f"未知日期: {day}")

            d = days.index(day)
            model.Add(x[i, d, "OFF"] == 1)

    # C6：最大连续工作天数
    if max_consecutive < d_count:
        window = max_consecutive + 1

        for i in range(n):
            for start in range(d_count - window + 1):
                model.Add(
                    sum(
                        x[i, d, s]
                        for d in range(start, start + window)
                        for s in WORK
                    ) <= max_consecutive
                )

    # C7：夜班次数上限
    if max_nights is not None:
        for i in range(n):
            model.Add(
                sum(
                    x[i, d, "N"]
                    for d in range(d_count)
                ) <= max_nights
            )

    # 优化目标：优先最少修改，其次减少不必要的工作班次
    changes = []
    work_assignments = []

    for i, employee in enumerate(employees):
        for d in range(d_count):
            original = employee["shifts"][d]

            changes.append(1 - x[i, d, original])

            for s in WORK:
                work_assignments.append(x[i, d, s])

    weight = n * d_count + 1

    model.Minimize(
        weight * sum(changes)
        + sum(work_assignments)
    )

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit
    solver.parameters.num_search_workers = 4
    solver.parameters.random_seed = 42

    status = solver.Solve(model)
    status_name = solver.StatusName(status)

    result = {
        "status": status_name,
        "wall_time_seconds": solver.WallTime()
    }

    if status not in (
        cp_model.OPTIMAL,
        cp_model.FEASIBLE
    ):
        result["repaired_schedule"] = None
        result["changes"] = []
        return result

    repaired = deepcopy(data)
    modifications = []

    for i, employee in enumerate(employees):
        for d, day in enumerate(days):
            selected = next(
                s for s in SHIFTS
                if solver.Value(x[i, d, s]) == 1
            )

            original = employee["shifts"][d]
            repaired["employees"][i]["shifts"][d] = selected

            if original != selected:
                modifications.append({
                    "employee": employee["name"],
                    "day": day,
                    "from": original,
                    "to": selected
                })

    result.update({
        "changed_assignments": len(modifications),
        "optimality_proven": status == cp_model.OPTIMAL,
        "changes": modifications,
        "repaired_schedule": repaired
    })

    return result


if __name__ == "__main__":
    try:
        if len(sys.argv) > 1 and sys.argv[1] == "-":
            problem = json.load(sys.stdin)
        else:
            with open(sys.argv[1], encoding="utf-8") as f:
                problem = json.load(f)

        result = solve_schedule(problem)
    except (ValueError, KeyError, IndexError, TypeError, OSError, json.JSONDecodeError) as e:
        result = {
            "status": "INPUT_ERROR",
            "error": str(e)
        }

    print(json.dumps(result, ensure_ascii=False, indent=2))
