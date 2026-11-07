package push

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"testing"
	"time"
)

func TestSignAndVerifyRoundTrip(t *testing.T) {
	token, err := Sign("test-secret", "user_1", "task-critical", "task_1", "complete", "sub_1", time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	got, err := Verify(token, "test-secret")
	if err != nil {
		t.Fatal(err)
	}
	if got.UserID != "user_1" || got.EntityID != "task_1" || got.Action != "complete" {
		t.Fatalf("%+v", got)
	}
	if _, err := Verify(token, "other-secret"); err == nil {
		t.Fatal("expected a bad signature")
	}
}

func TestLegacyTokenUsesTheRawPayloadBytes(t *testing.T) {
	body := []byte(`{"entityType":"task-critical","entityId":"task_9","userId":"user_9","action":"snooze15","exp":` + itoa(time.Now().Add(time.Hour).UnixMilli()) + `}`)
	mac := hmacHex("legacy-secret", body)
	wrapped, _ := json.Marshal(struct {
		P json.RawMessage `json:"p"`
		S string          `json:"s"`
	}{P: body, S: mac})
	token := encode(wrapped)
	got, err := Verify(token, "legacy-secret")
	if err != nil {
		t.Fatal(err)
	}
	if got.Action != "snooze" || got.EntityID != "task_9" || got.UserID != "user_9" {
		t.Fatalf("%+v", got)
	}
}

func hmacHex(secret string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

func encode(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}
