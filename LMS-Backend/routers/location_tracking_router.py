from fastapi import APIRouter, HTTPException, Query, status
import oracledb
from core.database import get_connection
from core.dependencies import require_hr_admin

router = APIRouter(prefix="/location-tracking", tags=["Location Tracking"])

class LocationTrackingSettings:
    """Employee location tracking settings"""
    def __init__(self, emp_code: str, track_location: str, track_location_hr: int = None):
        self.emp_code = emp_code
        self.track_location = track_location  # 'Y' or 'N'
        self.track_location_hr = track_location_hr or 2  # Default 2 hours if not set

@router.get("/settings/{emp_code}")
async def get_tracking_settings(emp_code: str):
    """
    Get location tracking settings for an employee from HR_EMP_MASTER
    
    Query Parameters:
    - emp_code: Employee code/ID
    
    Returns:
    {
        "emp_code": "100505.1",
        "employee_name": "ABDUL BASIT LASHARI",
        "track_location": "Y",  # 'Y' to enable, 'N' to disable
        "track_location_hr": 2,  # Track location every 2 hours (minimum 1)
        "status": "active"
    }
    """
    try:
        connection = get_connection()
        cursor = connection.cursor()
        
        # Query HR_EMP_MASTER for tracking settings
        cursor.execute("""
            SELECT 
                EMPCODE, 
                NAME, 
                TRACK_LOCATION, 
                TRACK_LOCATION_HR,
                STATUS
            FROM HR_EMP_MASTER 
            WHERE EMPCODE = :emp_code
        """, {"emp_code": emp_code})
        
        result = cursor.fetchone()
        connection.close()
        
        if not result:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Employee {emp_code} not found"
            )
        
        empcode, name, track_location, track_location_hr, status_val = result
        
        # Validate tracking parameters
        track_location = track_location or 'N'  # Default to 'N' if NULL
        track_location_hr = max(1, track_location_hr or 2)  # Minimum 1 hour, default 2
        
        return {
            "emp_code": empcode,
            "employee_name": name,
            "track_location": track_location,
            "track_location_hr": int(track_location_hr),
            "status": status_val,
            "message": "Location tracking is ENABLED" if track_location == 'Y' 
                      else "Location tracking is DISABLED"
        }
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error fetching tracking settings: {str(e)}"
        )


@router.post("/settings/{emp_code}/update")
async def update_tracking_settings(
    emp_code: str,
    track_location: str,
    track_location_hr: int = 2,
    admin_card_no: str = Query(..., description="Card no of requesting HR admin"),
):
    """
    Update location tracking settings for an employee
    
    Parameters:
    - emp_code: Employee code
    - track_location: 'Y' to enable, 'N' to disable
    - track_location_hr: Interval in hours (1-24)
    
    Returns: Updated settings
    """
    require_hr_admin(admin_card_no)
    try:
        # Validate inputs
        if track_location.upper() not in ['Y', 'N']:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="track_location must be 'Y' or 'N'"
            )
        
        if not (1 <= track_location_hr <= 24):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="track_location_hr must be between 1 and 24 hours"
            )
        
        connection = get_connection()
        cursor = connection.cursor()
        
        # Update HR_EMP_MASTER
        cursor.execute("""
            UPDATE HR_EMP_MASTER 
            SET 
                TRACK_LOCATION = :track_location,
                TRACK_LOCATION_HR = :track_location_hr,
                USR_DATE_UPD = SYSDATE
            WHERE EMPCODE = :emp_code
        """, {
            "track_location": track_location.upper(),
            "track_location_hr": track_location_hr,
            "emp_code": emp_code
        })
        
        rows_updated = cursor.rowcount
        connection.commit()
        connection.close()

        if rows_updated == 0:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Employee {emp_code} not found"
            )
        
        return {
            "success": True,
            "emp_code": emp_code,
            "track_location": track_location.upper(),
            "track_location_hr": track_location_hr,
            "message": "Settings updated successfully"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error updating tracking settings: {str(e)}"
        )


@router.get("/geofence/{emp_code}")
async def get_geofence_settings(emp_code: str):
    """
    Get attendance geofence settings for an employee from HR_EMP_MASTER.

    The mobile app uses this to decide whether an employee may mark attendance:
    if LOCATION_FIXED = 'Y', the employee must be within MARGIN metres of
    (DEFAULT_LATITUDE, DEFAULT_LONGITUDE) to check in/out.

    Returns:
    {
        "emp_code": "100505.1",
        "employee_name": "ABDUL BASIT LASHARI",
        "location_fixed": "Y",          # 'Y' = geofence enforced, 'N' = anywhere
        "latitude": 24.85851,           # office latitude (DEFAULT_LATITUDE)
        "longitude": 67.05,             # office longitude (DEFAULT_LONGITUDE)
        "margin": 200,                  # allowed radius in metres (MARGIN)
        "geofence_enabled": true        # convenience flag for the app
    }
    """
    connection = None
    try:
        connection = get_connection()
        cursor = connection.cursor()
        cursor.execute("""
            SELECT EMPCODE, NAME, LOCATION_FIXED,
                   DEFAULT_LATITUDE, DEFAULT_LONGITUDE, MARGIN
            FROM HR_EMP_MASTER
            WHERE EMPCODE = :emp_code
               OR TO_CHAR("ATDTCARD#") = :emp_code
            FETCH FIRST 1 ROWS ONLY
        """, {"emp_code": emp_code})
        result = cursor.fetchone()
        connection.close()
        connection = None

        if not result:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Employee {emp_code} not found",
            )

        empcode, name, location_fixed, lat, lon, margin = result
        fixed = (location_fixed or "N").strip().upper()
        lat_f = float(lat) if lat is not None else None
        lon_f = float(lon) if lon is not None else None
        margin_f = float(margin) if margin is not None else 200.0

        # Geofence only applies when explicitly enabled AND coordinates exist
        enabled = fixed == "Y" and lat_f is not None and lon_f is not None

        return {
            "emp_code": empcode,
            "employee_name": name,
            "location_fixed": fixed,
            "latitude": lat_f,
            "longitude": lon_f,
            "margin": margin_f if margin_f and margin_f > 0 else 200.0,
            "geofence_enabled": enabled,
        }

    except HTTPException:
        raise
    except Exception as e:
        if connection:
            connection.close()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error fetching geofence settings: {str(e)}",
        )


@router.get("/active-employees")
async def get_active_tracking_employees():
    """
    Get all employees with location tracking enabled (TRACK_LOCATION = 'Y')
    
    Returns list of employees with their tracking intervals
    """
    try:
        connection = get_connection()
        cursor = connection.cursor()
        
        cursor.execute("""
            SELECT 
                EMPCODE,
                NAME,
                TRACK_LOCATION,
                TRACK_LOCATION_HR,
                LOCATION,
                DEPT_NO,
                STATUS
            FROM HR_EMP_MASTER
            WHERE TRACK_LOCATION = 'Y' AND STATUS = 'A'
            ORDER BY EMPCODE
        """)
        
        results = cursor.fetchall()
        connection.close()
        
        employees = []
        for row in results:
            empcode, name, track_location, track_location_hr, location, dept_no, status_val = row
            employees.append({
                "emp_code": empcode,
                "employee_name": name,
                "track_location_hr": int(track_location_hr or 2),
                "location": location,
                "department": dept_no,
                "status": status_val
            })
        
        return {
            "total_tracking": len(employees),
            "employees": employees
        }
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error fetching tracking employees: {str(e)}"
        )


@router.get("/statistics")
async def get_tracking_statistics():
    """
    Get location tracking statistics
    
    Returns:
    {
        "total_employees": 643,
        "tracking_enabled": 45,
        "tracking_disabled": 598,
        "average_interval_hours": 2.3
    }
    """
    try:
        connection = get_connection()
        cursor = connection.cursor()
        
        cursor.execute("""
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN TRACK_LOCATION = 'Y' THEN 1 ELSE 0 END) as enabled,
                SUM(CASE WHEN TRACK_LOCATION = 'Y' THEN TRACK_LOCATION_HR ELSE 0 END) as total_hours,
                AVG(CASE WHEN TRACK_LOCATION = 'Y' THEN TRACK_LOCATION_HR ELSE NULL END) as avg_hours
            FROM HR_EMP_MASTER
        """)
        
        result = cursor.fetchone()
        connection.close()
        
        total, enabled, total_hours, avg_hours = result
        enabled = enabled or 0
        disabled = (total or 0) - enabled
        
        return {
            "total_employees": total or 0,
            "tracking_enabled": enabled,
            "tracking_disabled": disabled,
            "average_interval_hours": round(avg_hours or 2.0, 2),
            "total_tracking_hours": int(total_hours or 0)
        }
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error fetching statistics: {str(e)}"
        )
