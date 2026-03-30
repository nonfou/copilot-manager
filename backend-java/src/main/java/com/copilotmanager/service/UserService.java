package com.copilotmanager.service;

import com.copilotmanager.crypto.PasswordService;
import com.copilotmanager.idgen.IdGen;
import com.copilotmanager.model.User;
import com.copilotmanager.repository.UserRepository;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.List;

@Service
public class UserService {

    private final UserRepository userRepository;
    private final PasswordService passwordService;

    public UserService(UserRepository userRepository, PasswordService passwordService) {
        this.userRepository = userRepository;
        this.passwordService = passwordService;
    }

    public User findByUsername(String username) {
        return userRepository.findByUsername(username).orElse(null);
    }

    public User findById(String id) {
        return userRepository.findById(id).orElse(null);
    }

    public List<User> findAll() {
        return userRepository.findAll();
    }

    public User createUser(String username, String password, String role, String createdBy) {
        User u = new User();
        u.setId(IdGen.generateId("usr"));
        u.setUsername(username);
        u.setPasswordHash(passwordService.hash(password));
        u.setRole(role != null ? role : "user");
        u.setCreatedAt(Instant.now().toString());
        u.setCreatedBy(createdBy);
        return userRepository.save(u);
    }

    public User save(User user) {
        return userRepository.save(user);
    }

    public boolean changePassword(String userId, String oldPassword, String newPassword) {
        User u = userRepository.findById(userId).orElse(null);
        if (u == null) return false;
        if (!passwordService.verify(oldPassword, u.getPasswordHash())) return false;
        u.setPasswordHash(passwordService.hash(newPassword));
        userRepository.save(u);
        return true;
    }

    public void resetPassword(String userId, String newPassword) {
        User u = userRepository.findById(userId).orElse(null);
        if (u == null) return;
        u.setPasswordHash(passwordService.hash(newPassword));
        userRepository.save(u);
    }

    public void delete(String id) {
        userRepository.deleteById(id);
    }

    public boolean verifyPassword(String plainPassword, String passwordHash) {
        return passwordService.verify(plainPassword, passwordHash);
    }

    public String hashPassword(String password) {
        return passwordService.hash(password);
    }
}
