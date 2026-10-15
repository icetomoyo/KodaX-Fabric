export type ProductType = "api" | "coding_plan";

export type ProductRow = {
  id: number;
  providerId: number;
  providerCode: string;
  name: string;
  code: string;
  productType: ProductType;
  seatCount: number;
  tag: string;
  status: string;
  configVersion: number;
  weeklyWindowResetAt: string | null;
  monthlyWindowResetAt: string | null;
  fiveHourCreditLimit: number | null;
  weeklyCreditLimit: number | null;
  monthlyCreditLimit: number | null;
  zhipuOrganizationId: string | null;
  zhipuProjectId: string | null;
  officialQuotaQueryEnabled: boolean;
};

export type SeatRow = {
  id: number;
  employeeId: number;
  employeeName: string;
  employeePhone: string;
  enterpriseName: string | null;
  productLineId: number;
  tag: string;
  secretSuffix: string | null;
  createdAt: string;
};

export type EmployeeOption = { id: number; name: string; phone: string };

export type CredentialRow = {
  id: number;
  productLineId: number;
  label: string;
  secretSuffix: string;
  status: string;
  createdAt: string;
};

export type CreateProductInput = {
  name: string;
  tag: string;
  seatCount: number;
  variant?: "domestic" | "international";
};

export type EditProductForm = {
  id: number;
  configVersion: number;
  productType: ProductType;
  providerCode: string;
  name: string;
  tag: string;
  seatCount: number;
  status: "active" | "disabled";
  weeklyWindowResetAt: Date | null;
  monthlyWindowResetAt: Date | null;
  fiveHourCreditLimit: string;
  weeklyCreditLimit: string;
  monthlyCreditLimit: string;
  zhipuOrganizationId: string;
  zhipuProjectId: string;
  officialQuotaQueryEnabled: boolean;
};
