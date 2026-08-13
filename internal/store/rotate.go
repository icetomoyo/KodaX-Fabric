package store

import "time"

const DefaultRotationGrace = 24 * time.Hour

func NormalizeRotationSchedule(activate, retire *time.Time) (*time.Time, *time.Time, error) {
	if activate == nil && retire != nil {
		return nil, nil, ErrInvalidRotationSchedule
	}
	if activate != nil && retire != nil && !retire.After(*activate) {
		return nil, nil, ErrInvalidRotationSchedule
	}
	if activate != nil && retire == nil {
		t := activate.Add(DefaultRotationGrace)
		retire = &t
	}
	return activate, retire, nil
}

func ReplacementPhase(hasRepl bool, activate, retire *time.Time, now time.Time) (pending, overlap, done bool) {
	if !hasRepl {
		return false, false, false
	}
	if activate == nil || now.Before(*activate) {
		return true, false, false
	}
	if retire == nil || now.Before(*retire) {
		return false, true, false
	}
	return false, false, true
}
