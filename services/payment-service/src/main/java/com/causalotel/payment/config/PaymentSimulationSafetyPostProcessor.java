package com.causalotel.payment.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.env.EnvironmentPostProcessor;
import org.springframework.core.env.ConfigurableEnvironment;

import java.util.Arrays;
import java.util.Locale;
import java.util.Set;

/**
 * L-02: fail-closed pre-startup validator.
 *
 * <p>Payment simulation is disabled by default. It may only be enabled when an
 * explicit demo, dev, or test profile is active, and it is always prohibited in
 * production profiles. This prevents a staging deployment that forgot a prod
 * profile from silently simulating charges.</p>
 */
public class PaymentSimulationSafetyPostProcessor implements EnvironmentPostProcessor {

    private static final Logger log = LoggerFactory.getLogger(PaymentSimulationSafetyPostProcessor.class);
    private static final Set<String> FORBIDDEN_PROFILES = Set.of("prod", "production");
    private static final Set<String> ALLOWED_SIMULATION_PROFILES = Set.of("demo", "dev", "test");

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        String simEnabledVal = environment.getProperty("causalotel.payment.simulation.enabled", "false");
        boolean simulationEnabled = Boolean.parseBoolean(simEnabledVal);

        if (!simulationEnabled) {
            return;
        }

        String[] activeProfiles = environment.getActiveProfiles();
        for (String profile : activeProfiles) {
            if (FORBIDDEN_PROFILES.contains(profile.toLowerCase(Locale.ROOT))) {
                throw new IllegalStateException(
                        "CRITICAL SAFETY VIOLATION: Payment gateway simulation mode cannot be enabled when profile '"
                                + profile + "' is active! Aborting startup to prevent simulated transactions in production."
                );
            }
        }

        boolean explicitSimulationProfile = Arrays.stream(activeProfiles)
                .map(profile -> profile.toLowerCase(Locale.ROOT))
                .anyMatch(ALLOWED_SIMULATION_PROFILES::contains);
        if (!explicitSimulationProfile) {
            throw new IllegalStateException(
                    "SAFETY VIOLATION: Payment simulation is enabled but no demo/dev/test profile is active. "
                            + "Set SPRING_PROFILES_ACTIVE=demo or disable PAYMENT_SIMULATION_ENABLED."
            );
        }

        log.warn("PAYMENT SIMULATION MODE IS ACTIVE (profiles={}). No real charges will be made.",
                String.join(",", activeProfiles));
    }
}
