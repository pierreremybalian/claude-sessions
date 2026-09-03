import os from "node:os";

/** The address other devices on the wifi can reach — en0 first, it's the Mac's wifi. */
export function lanAddress() {
  const ifaces = os.networkInterfaces();
  const names = Object.keys(ifaces).sort((a, b) => (a === "en0" ? -1 : b === "en0" ? 1 : 0));
  for (const name of names) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === "IPv4" && !ni.internal) return ni.address;
    }
  }
  return null;
}

/** Bonjour name (`my-mac.local`), which survives DHCP handing out a new IP. */
export function bonjourHost() {
  const h = os.hostname();
  if (!h) return null;
  return h.endsWith(".local") ? h : `${h}.local`;
}
