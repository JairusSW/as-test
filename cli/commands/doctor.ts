import { doctor } from "./doctor-core.js";

export { doctor } from "./doctor-core.js";

export async function executeDoctorCommand(
  configPath: string | undefined,
  selectedModes: string[],
): Promise<void> {
  await doctor(configPath, selectedModes);
}
