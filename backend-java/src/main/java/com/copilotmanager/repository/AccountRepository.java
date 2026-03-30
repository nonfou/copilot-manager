package com.copilotmanager.repository;

import com.copilotmanager.model.Account;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface AccountRepository extends JpaRepository<Account, String> {
    List<Account> findByOwnerId(String ownerId);
    List<Account> findAllByOrderByCreatedAtAsc();
    long countByOwnerId(String ownerId);
}
