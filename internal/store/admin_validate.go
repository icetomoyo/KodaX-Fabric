package store

import "fmt"

const (
	StatusActive   = "active"
	StatusDisabled = "disabled"
	GroupStandard  = "standard"
	GroupPremium   = "premium"
	GroupBulk      = "bulk"
)

func badRequest(msg string) error {
	return fmt.Errorf("%w: %s", ErrBadRequest, msg)
}

func ValidateProtocol(p string) error {
	if p != ProtocolOpenAI && p != ProtocolAnthropic {
		return badRequest("invalid protocol")
	}
	return nil
}

func ValidateStatus(s string) error {
	if s != StatusActive && s != StatusDisabled {
		return badRequest("invalid status")
	}
	return nil
}

func ValidateGroup(g string) error {
	if g != GroupStandard && g != GroupPremium && g != GroupBulk {
		return badRequest("invalid group")
	}
	return nil
}

func ValidateNonNegInt(n int, name string) error {
	if n < 0 {
		return badRequest(name + " must be non-negative")
	}
	return nil
}

func ValidateNonNegInt64(n int64, name string) error {
	if n < 0 {
		return badRequest(name + " must be non-negative")
	}
	return nil
}

func ValidateWeight(w int) error {
	if w < 0 {
		return badRequest("invalid weight")
	}
	return nil
}

func ValidatePriority(p int) error {
	if p < 0 {
		return badRequest("invalid priority")
	}
	return nil
}

func ValidateSecret(s string) error {
	if s == "" {
		return badRequest("secret required")
	}
	return nil
}

func ValidateProviderCode(s string) error {
	if s == "" {
		return badRequest("provider_code required")
	}
	return nil
}

func ValidateName(s string) error {
	if s == "" {
		return badRequest("name required")
	}
	return nil
}

func ValidateBaseURL(s string) error {
	if s == "" {
		return badRequest("base_url required")
	}
	return nil
}

func ValidateTeamMatch(poolTeam, keyTeam int64) error {
	if poolTeam != keyTeam {
		return badRequest("team mismatch")
	}
	return nil
}

func applyProviderPatch(cur *ProviderWrite, in ProviderPatch) error {
	if in.ProviderCode != nil {
		if err := ValidateProviderCode(*in.ProviderCode); err != nil {
			return err
		}
		cur.ProviderCode = *in.ProviderCode
	}
	if in.Secret != nil {
		if err := ValidateSecret(*in.Secret); err != nil {
			return err
		}
		cur.Secret = *in.Secret
	}
	if in.Status != nil {
		if err := ValidateStatus(*in.Status); err != nil {
			return err
		}
		cur.Status = *in.Status
	}
	if in.RPMLimit != nil {
		if err := ValidateNonNegInt(*in.RPMLimit, "rpm_limit"); err != nil {
			return err
		}
		cur.RPMLimit = *in.RPMLimit
	}
	if in.RPMBurst != nil {
		if err := ValidateNonNegInt(*in.RPMBurst, "rpm_burst"); err != nil {
			return err
		}
		cur.RPMBurst = *in.RPMBurst
	}
	if in.TeamID != nil {
		cur.TeamID = *in.TeamID
	}
	return nil
}

func applyPoolPatch(cur *ChannelPool, in PoolPatch) error {
	if in.Name != nil {
		if err := ValidateName(*in.Name); err != nil {
			return err
		}
		cur.Name = *in.Name
	}
	if in.GroupName != nil {
		if err := ValidateGroup(*in.GroupName); err != nil {
			return err
		}
		cur.GroupName = *in.GroupName
	}
	if in.TeamID != nil {
		cur.TeamID = *in.TeamID
	}
	return nil
}

func applyChannelPatch(cur *ChannelAdmin, in ChannelPatch) error {
	if in.PoolID != nil {
		if *in.PoolID == 0 {
			return badRequest("pool_id required")
		}
		cur.PoolID = *in.PoolID
	}
	if in.ProviderKeyID != nil {
		if *in.ProviderKeyID == 0 {
			return badRequest("provider_key_id required")
		}
		cur.ProviderKeyID = *in.ProviderKeyID
	}
	if in.Protocol != nil {
		if err := ValidateProtocol(*in.Protocol); err != nil {
			return err
		}
		cur.Protocol = *in.Protocol
	}
	if in.BaseURL != nil {
		if err := ValidateBaseURL(*in.BaseURL); err != nil {
			return err
		}
		cur.BaseURL = *in.BaseURL
	}
	if in.Status != nil {
		if err := ValidateStatus(*in.Status); err != nil {
			return err
		}
		cur.Status = *in.Status
	}
	if in.Priority != nil {
		if err := ValidatePriority(*in.Priority); err != nil {
			return err
		}
		cur.Priority = *in.Priority
	}
	if in.Weight != nil {
		if err := ValidateWeight(*in.Weight); err != nil {
			return err
		}
		cur.Weight = *in.Weight
	}
	if in.Models != nil {
		cur.Models = append([]string(nil), (*in.Models)...)
	}
	return nil
}

func applyVKPatch(cur *VirtualKeyAdmin, in VirtualKeyPatch) error {
	if in.PoolID != nil {
		if *in.PoolID == 0 {
			return badRequest("pool_id required")
		}
		cur.PoolID = *in.PoolID
	}
	if in.ProjectID != nil {
		cur.ProjectID = *in.ProjectID
	}
	if in.Status != nil {
		if err := ValidateStatus(*in.Status); err != nil {
			return err
		}
		cur.Status = *in.Status
	}
	if in.ExpiresAt != nil {
		t := *in.ExpiresAt
		cur.ExpiresAt = &t
	}
	if in.ModelScope != nil {
		cur.ModelScope = append([]string(nil), (*in.ModelScope)...)
	}
	if in.IPAllow != nil {
		cur.IPAllow = append([]string(nil), (*in.IPAllow)...)
	}
	if in.RPMLimit != nil {
		if err := ValidateNonNegInt(*in.RPMLimit, "rpm_limit"); err != nil {
			return err
		}
		cur.RPMLimit = *in.RPMLimit
	}
	if in.RPMBurst != nil {
		if err := ValidateNonNegInt(*in.RPMBurst, "rpm_burst"); err != nil {
			return err
		}
		cur.RPMBurst = *in.RPMBurst
	}
	if in.MonthlyHard != nil {
		if err := ValidateNonNegInt64(*in.MonthlyHard, "monthly_hard"); err != nil {
			return err
		}
		cur.MonthlyHard = *in.MonthlyHard
	}
	if in.MonthlySoft != nil {
		if err := ValidateNonNegInt64(*in.MonthlySoft, "monthly_soft"); err != nil {
			return err
		}
		cur.MonthlySoft = *in.MonthlySoft
	}
	return nil
}

func validateProviderWrite(in *ProviderWrite) error {
	if err := ValidateProviderCode(in.ProviderCode); err != nil {
		return err
	}
	if err := ValidateSecret(in.Secret); err != nil {
		return err
	}
	if in.Status == "" {
		in.Status = StatusActive
	}
	if err := ValidateStatus(in.Status); err != nil {
		return err
	}
	if err := ValidateNonNegInt(in.RPMLimit, "rpm_limit"); err != nil {
		return err
	}
	if err := ValidateNonNegInt(in.RPMBurst, "rpm_burst"); err != nil {
		return err
	}
	return nil
}

func validatePoolWrite(in *ChannelPool) error {
	if err := ValidateName(in.Name); err != nil {
		return err
	}
	if in.GroupName == "" {
		in.GroupName = GroupStandard
	}
	if err := ValidateGroup(in.GroupName); err != nil {
		return err
	}
	return nil
}

func validateChannelWrite(in *ChannelAdmin) error {
	if in.PoolID == 0 || in.ProviderKeyID == 0 {
		return badRequest("pool_id and provider_key_id required")
	}
	if err := ValidateProtocol(in.Protocol); err != nil {
		return err
	}
	if err := ValidateBaseURL(in.BaseURL); err != nil {
		return err
	}
	if in.Status == "" {
		in.Status = StatusActive
	}
	if err := ValidateStatus(in.Status); err != nil {
		return err
	}
	if err := ValidatePriority(in.Priority); err != nil {
		return err
	}
	if err := ValidateWeight(in.Weight); err != nil {
		return err
	}
	if in.Weight == 0 {
		in.Weight = 100
	}
	return nil
}

func validateVKWrite(in *VirtualKeyAdmin) error {
	if in.PoolID == 0 {
		return badRequest("pool_id required")
	}
	if in.Status == "" {
		in.Status = StatusActive
	}
	if err := ValidateStatus(in.Status); err != nil {
		return err
	}
	if err := ValidateNonNegInt(in.RPMLimit, "rpm_limit"); err != nil {
		return err
	}
	if err := ValidateNonNegInt(in.RPMBurst, "rpm_burst"); err != nil {
		return err
	}
	if err := ValidateNonNegInt64(in.MonthlyHard, "monthly_hard"); err != nil {
		return err
	}
	if err := ValidateNonNegInt64(in.MonthlySoft, "monthly_soft"); err != nil {
		return err
	}
	return nil
}

func providerView(id int64, p *ProviderWrite) *ProviderKeyView {
	return &ProviderKeyView{
		ID: id, ProviderCode: p.ProviderCode, Status: p.Status,
		TeamID: p.TeamID, RPMLimit: p.RPMLimit, RPMBurst: p.RPMBurst,
	}
}
