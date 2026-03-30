package com.copilotmanager.crypto;

import org.bouncycastle.crypto.generators.SCrypt;
import org.springframework.stereotype.Service;

import java.security.MessageDigest;
import java.security.SecureRandom;

@Service
public class PasswordService {

    private static final int N = 16384;
    private static final int R = 8;
    private static final int P = 1;
    private static final int KEY_LEN = 64;
    private static final int SALT_LEN = 16;

    public String hash(String password) {
        byte[] salt = new byte[SALT_LEN];
        new SecureRandom().nextBytes(salt);
        byte[] dk = SCrypt.generate(
                password.getBytes(java.nio.charset.StandardCharsets.UTF_8),
                salt, N, R, P, KEY_LEN);
        return EncryptionService.bytesToHex(salt) + ":" + EncryptionService.bytesToHex(dk);
    }

    public boolean verify(String password, String stored) {
        if (stored == null || stored.isBlank()) return false;
        String[] parts = stored.split(":", 2);
        if (parts.length != 2) return false;
        try {
            byte[] salt = EncryptionService.hexToBytes(parts[0]);
            byte[] expected = EncryptionService.hexToBytes(parts[1]);
            byte[] dk = SCrypt.generate(
                    password.getBytes(java.nio.charset.StandardCharsets.UTF_8),
                    salt, N, R, P, KEY_LEN);
            return MessageDigest.isEqual(dk, expected);
        } catch (Exception e) {
            return false;
        }
    }
}
