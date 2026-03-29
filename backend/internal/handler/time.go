package handler

import "time"

// nowISO returns the current UTC time in RFC3339 format.
func nowISO() string {
	return time.Now().UTC().Format(time.RFC3339)
}
