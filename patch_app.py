with open('app.py', 'r', encoding='utf-8') as f:
    content = f.read()

old_func_start = content.find('def _data_window_state')
old_func_end = content.find('def _ensure_data()', old_func_start)
old_func = content[old_func_start:old_func_end]

new_func = """def _data_window_state(current_anchor: str) -> tuple[bool, bool]:
    input_dir = BASE_DIR / "data" / "inputs"
    required_files = [
        "master_operations.csv",
        "booking_journey.csv",
        "capacity_demand.csv",
        "channel_volume.csv",
        "engineer_availability.csv",
        "engineers.csv",
        "field_engineers.csv",
        "financial_data.csv",
        "forecast_baseline_2025.csv",
        "suppliers.csv"
    ]
    
    for f in required_files:
        if not (input_dir / f).exists():
            print(f"IMSERV: Missing required file {f}.")
            return True, False

    from engine.date_windows import rolling_actual_window, parse_iso_date
    actual_start, _ = rolling_actual_window()

    try:
        import csv as _csv
        
        # Check master_operations.csv strictly
        with open(input_dir / "master_operations.csv", encoding="utf-8-sig", newline="") as f:
            reader = _csv.DictReader(f)
            first_row = next(reader, None)
            if not first_row:
                return True, False
            rd = parse_iso_date(first_row.get("requested_date", ""))
            if rd != actual_start:
                print(f"IMSERV: master_operations.csv first date {rd} != expected {actual_start}. Marking stale.")
                return False, True
                
        # Check booking_journey.csv strictly
        with open(input_dir / "booking_journey.csv", encoding="utf-8-sig", newline="") as f:
            reader = _csv.DictReader(f)
            first_row = next(reader, None)
            if not first_row:
                return True, False
            ws = parse_iso_date(first_row.get("week_start", ""))
            if not ws or abs((ws - actual_start).days) > 7:
                print(f"IMSERV: booking_journey.csv out of sync with {actual_start}. Marking stale.")
                return False, True

    except Exception as e:
        print(f"IMSERV: CSV spot-check error: {e}. Marking stale.")
        return False, True

    return False, False

"""

if old_func_start != -1:
    content = content[:old_func_start] + new_func + content[old_func_end:]
    with open('app.py', 'w', encoding='utf-8') as f:
        f.write(content)
    print('Patched app.py successfully with all files checked')
else:
    print('Failed to find _data_window_state')
