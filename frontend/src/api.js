const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

async function requestJson(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const message = data.error || data.message || `Request failed with ${response.status}`;
    throw new Error(message);
  }

  return data;
}

export async function getConnectedDevices() {
  const payload = await requestJson('/devices/');
  return payload.devices || [];
}

export async function getRegisteredDevices() {
  const payload = await requestJson('/registered-devices/');
  return payload.registered_devices || [];
}

export async function getLogs() {
  const payload = await requestJson('/logs/');
  return payload.logs || [];
}

export async function registerDevice(macAddress, name, colour) {
  return requestJson('/registered-devices/', {
    method: 'POST',
    body: JSON.stringify({ mac_address: macAddress, name, colour }),
  });
}

export async function updateDevice(macAddress, fields) {
  return requestJson('/registered-devices/', {
    method: 'PATCH',
    body: JSON.stringify({ mac_address: macAddress, ...fields }),
  });
}
