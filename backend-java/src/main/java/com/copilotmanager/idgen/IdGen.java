package com.copilotmanager.idgen;

import java.security.SecureRandom;
import java.util.Base64;

public final class IdGen {

    private static final SecureRandom RANDOM = new SecureRandom();

    private IdGen() {}

    public static String generateId(String prefix) {
        byte[] bytes = new byte[8];
        RANDOM.nextBytes(bytes);
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) sb.append(String.format("%02x", b));
        return prefix + "_" + sb;
    }

    public static String generateApiKey() {
        // sk-ant-api03-<40 bytes base64url>
        byte[] bytes = new byte[40];
        RANDOM.nextBytes(bytes);
        String b64 = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        return "sk-ant-api03-" + b64;
    }

    public static String generateSessionId() {
        byte[] bytes = new byte[16];
        RANDOM.nextBytes(bytes);
        StringBuilder sb = new StringBuilder(32);
        for (byte b : bytes) sb.append(String.format("%02x", b));
        return sb.toString();
    }
}
