import { doctor } from "./doctor-core.js";
export { doctor } from "./doctor-core.js";
export async function executeDoctorCommand(configPath, selectedModes) {
    await doctor(configPath, selectedModes);
}
