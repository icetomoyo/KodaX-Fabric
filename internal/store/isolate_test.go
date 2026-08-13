package store

import "testing"

func TestIsolateChannelsDropsForeignTeamKey(t *testing.T) {
	vk := &ResolvedVK{
		VirtualKeyID: 1, PoolID: 10, TeamID: 1, ProjectID: 100, PoolGroup: "premium",
		Channels: []Channel{
			{ID: 1, PoolID: 10, TeamID: 1, KeyTeamID: 1, Secret: "sk-a"},
			{ID: 2, PoolID: 10, TeamID: 2, KeyTeamID: 2, Secret: "sk-b"},
			{ID: 3, PoolID: 10, TeamID: 1, KeyTeamID: 2, Secret: "sk-leak"},
		},
	}
	got := IsolateChannels(vk)
	if len(got.Channels) != 1 || got.Channels[0].ID != 1 {
		t.Fatalf("channels %+v", got.Channels)
	}
}

func TestIsolateChannelsNoopWithoutTeam(t *testing.T) {
	vk := &ResolvedVK{
		VirtualKeyID: 1, PoolID: 10,
		Channels: []Channel{{ID: 1, Secret: "sk-a"}, {ID: 2, Secret: "sk-b"}},
	}
	got := IsolateChannels(vk)
	if len(got.Channels) != 2 {
		t.Fatalf("legacy channels %d", len(got.Channels))
	}
}

func TestIsolateOwnerlessDropsTeamedChannel(t *testing.T) {
	vk := &ResolvedVK{
		VirtualKeyID: 1, PoolID: 10,
		Channels: []Channel{
			{ID: 1, PoolID: 10, TeamID: 0, KeyTeamID: 0, Secret: "sk-legacy"},
			{ID: 2, PoolID: 10, TeamID: 2, KeyTeamID: 2, Secret: "sk-b"},
		},
	}
	got := IsolateChannels(vk)
	if len(got.Channels) != 1 || got.Channels[0].ID != 1 {
		t.Fatalf("channels %+v", got.Channels)
	}
}

func TestIsolateTeamRejectsZeroPoolID(t *testing.T) {
	vk := &ResolvedVK{
		VirtualKeyID: 1, PoolID: 10, TeamID: 1,
		Channels: []Channel{
			{ID: 1, PoolID: 0, TeamID: 1, KeyTeamID: 1, Secret: "sk-wild"},
		},
	}
	got := IsolateChannels(vk)
	if len(got.Channels) != 0 {
		t.Fatalf("wildcard pool leaked %+v", got.Channels)
	}
}
