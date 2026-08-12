package secret

import "testing"

func TestEncryptRoundTrip(t *testing.T) {
	key, err := ParseAESKey("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
	if err != nil {
		t.Fatal(err)
	}
	const plain = "sk-fixture-must-not-appear-in-caller-json"
	enc, err := Encrypt(key, plain)
	if err != nil {
		t.Fatal(err)
	}
	if enc == plain {
		t.Fatal("ciphertext equals plaintext")
	}
	got, err := Decrypt(key, enc)
	if err != nil {
		t.Fatal(err)
	}
	if got != plain {
		t.Fatalf("got %s", got)
	}
}

func TestHashVKStable(t *testing.T) {
	a := HashVK("fab-local-bootstrap-01")
	b := HashVK("fab-local-bootstrap-01")
	if a != b || len(a) != 64 {
		t.Fatalf("hash %s", a)
	}
}
