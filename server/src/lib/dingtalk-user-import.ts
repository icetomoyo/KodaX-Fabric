export type DingtalkImportCandidate = {
  userid: string;
  name: string;
  mobile: string | null;
  departmentId: number;
  enterpriseId: number;
  departmentName: string;
};

export type DingtalkUserCreate = {
  name: string;
  phone: string;
  departmentId: number;
  enterpriseId: number;
  departmentName: string;
  userid: string;
};

export type DingtalkUserImportPlan = {
  creates: DingtalkUserCreate[];
  skippedExisting: DingtalkImportCandidate[];
  skippedNoPhone: DingtalkImportCandidate[];
  skippedBadPhone: DingtalkImportCandidate[];
};

export function normalizeDingtalkMobile(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let phone = raw.replace(/[^\d+]/g, "");
  if (phone.startsWith("+86")) phone = phone.slice(3);
  else if (phone.startsWith("86") && phone.length === 13) phone = phone.slice(2);
  return phone || null;
}

export function planDingtalkUserImport(input: {
  candidates: readonly DingtalkImportCandidate[];
  existingPhones: ReadonlySet<string>;
}): DingtalkUserImportPlan {
  const seen = new Set(input.existingPhones);
  const creates: DingtalkUserCreate[] = [];
  const skippedExisting: DingtalkImportCandidate[] = [];
  const skippedNoPhone: DingtalkImportCandidate[] = [];
  const skippedBadPhone: DingtalkImportCandidate[] = [];

  for (const candidate of input.candidates) {
    const phone = normalizeDingtalkMobile(candidate.mobile);
    if (!phone) {
      skippedNoPhone.push(candidate);
      continue;
    }
    if (phone.length < 5 || phone.length > 20) {
      skippedBadPhone.push(candidate);
      continue;
    }
    if (seen.has(phone)) {
      skippedExisting.push(candidate);
      continue;
    }
    seen.add(phone);
    creates.push({
      name: candidate.name.slice(0, 100),
      phone,
      departmentId: candidate.departmentId,
      enterpriseId: candidate.enterpriseId,
      departmentName: candidate.departmentName,
      userid: candidate.userid,
    });
  }

  return { creates, skippedExisting, skippedNoPhone, skippedBadPhone };
}
