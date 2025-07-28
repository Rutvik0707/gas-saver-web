# Energy Rate Configuration API

## Overview
The energy rate system allows administrators to dynamically configure the amount of energy allocated per USDT transaction without requiring code changes or deployments.

## Database
- Table: `energy_rates`
- Only the latest `isActive` rate is used for calculations
- All historical rates are preserved for audit trail

## API Endpoints

### 1. Get Current Active Rate
**Endpoint:** `GET /api/v1/energy-rates/current`  
**Auth:** Required (any authenticated user)  
**Description:** Returns the currently active energy rate configuration

**Response:**
```json
{
  "success": true,
  "message": "Current energy rate retrieved successfully",
  "data": {
    "energyPerTransaction": 65000,
    "bufferPercentage": 20,
    "minEnergy": 65000,
    "maxEnergy": 150000,
    "effectiveDate": "2025-07-25T13:16:01.848Z"
  }
}
```

### 2. List All Rates (Admin)
**Endpoint:** `GET /api/v1/admin/energy-rates`  
**Auth:** Admin only  
**Query Params:** 
- `page` (default: 1)
- `limit` (default: 10)

**Response:**
```json
{
  "success": true,
  "message": "Energy rates retrieved successfully",
  "data": {
    "rates": [...],
    "total": 5,
    "page": 1,
    "limit": 10
  }
}
```

### 3. Get Rate History (Admin)
**Endpoint:** `GET /api/v1/admin/energy-rates/history`  
**Auth:** Admin only  
**Query Params:**
- `startDate` (optional)
- `endDate` (optional)

### 4. Get Rate by ID (Admin)
**Endpoint:** `GET /api/v1/admin/energy-rates/:id`  
**Auth:** Admin only

### 5. Create New Rate (Admin)
**Endpoint:** `POST /api/v1/admin/energy-rates`  
**Auth:** Admin only  
**Body:**
```json
{
  "energyPerTransaction": 70000,
  "bufferPercentage": 25,
  "minEnergy": 70000,
  "maxEnergy": 200000,
  "description": "Increased due to network congestion"
}
```

**Note:** Creating a new rate automatically deactivates all previous rates.

### 6. Update Existing Rate (Admin)
**Endpoint:** `PUT /api/v1/admin/energy-rates/:id`  
**Auth:** Admin only  
**Body:** Same as create (all fields optional)

## Integration

### Energy Calculation
The `EnergyService` now uses database rates:
```typescript
const currentRate = await energyRateService.getCurrentRate();
const baseEnergy = currentRate.energyPerTransaction;
const buffer = currentRate.bufferPercentage / 100;
```

### Pricing Service
The pricing calculations also use database rates for accurate cost estimation.

## Caching
- Current rate is cached for 5 minutes to improve performance
- Cache is automatically cleared when rates are updated

## Fallback
If no rate exists in the database, the system falls back to environment config values:
- `USDT_TRANSFER_ENERGY_BASE`: 65000
- `ENERGY_BUFFER_PERCENTAGE`: 0.2
- `MIN_ENERGY_DELEGATION`: 65000
- `MAX_ENERGY_DELEGATION`: 150000