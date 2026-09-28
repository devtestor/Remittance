import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { colors, radius } from "./theme";

export function AppShell({ children }: { children: React.ReactNode }) {
  return <View style={styles.shell}>{children}</View>;
}

export function Card({ children, tone = "plain" }: { children: React.ReactNode; tone?: "plain" | "dark" }) {
  return <View style={[styles.card, tone === "dark" ? styles.darkCard : undefined]}>{children}</View>;
}

export function Pill({ label, active = false }: { label: string; active?: boolean }) {
  return (
    <View style={[styles.pill, active ? styles.pillActive : undefined]}>
      <Text style={[styles.pillText, active ? styles.pillTextActive : undefined]}>{label}</Text>
    </View>
  );
}

export function PrimaryButton({
  label,
  loading = false,
  onPress
}: {
  label: string;
  loading?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity disabled={loading} onPress={onPress} style={styles.primaryButton}>
      {loading ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryButtonText}>{label}</Text>}
    </TouchableOpacity>
  );
}

export function GhostButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.ghostButton}>
      <Text style={styles.ghostButtonText}>{label}</Text>
    </TouchableOpacity>
  );
}

export function LabeledInput({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = "default"
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "email-address" | "numeric" | "phone-pad" | "url";
}) {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={keyboardType}
        onChangeText={onChangeText}
        placeholder={placeholder}
        style={styles.input}
        value={value}
      />
    </View>
  );
}

export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

export function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    gap: 16,
    marginHorizontal: "auto",
    maxWidth: 430,
    padding: 20,
    width: "100%"
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.outline,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: 14,
    padding: 18,
    shadowColor: "#001430",
    shadowOffset: { height: 5, width: 0 },
    shadowOpacity: 0.05,
    shadowRadius: 14,
    elevation: 2
  },
  darkCard: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    shadowOpacity: 0.14
  },
  pill: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.outline,
    borderRadius: radius.full,
    borderWidth: 1,
    minHeight: 42,
    justifyContent: "center",
    paddingHorizontal: 14
  },
  pillActive: {
    backgroundColor: colors.secondary,
    borderColor: colors.secondary
  },
  pillText: {
    color: colors.mutedStrong,
    fontSize: 13,
    fontWeight: "800"
  },
  pillTextActive: {
    color: colors.white
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.primaryContainer,
    borderRadius: radius.md,
    minHeight: 56,
    justifyContent: "center",
    shadowColor: colors.primaryContainer,
    shadowOffset: { height: 5, width: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 3
  },
  primaryButtonText: {
    color: colors.white,
    fontSize: 17,
    fontWeight: "900"
  },
  ghostButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceLow,
    borderRadius: radius.md,
    minHeight: 50,
    justifyContent: "center"
  },
  ghostButtonText: {
    color: colors.primaryContainer,
    fontSize: 15,
    fontWeight: "900"
  },
  inputGroup: {
    gap: 8
  },
  inputLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  input: {
    backgroundColor: colors.surfaceLow,
    borderColor: colors.outlineStrong,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  metric: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    flex: 1,
    padding: 14
  },
  metricLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800"
  },
  metricValue: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: "900",
    marginTop: 5
  },
  row: {
    gap: 4,
    paddingVertical: 8
  },
  rowLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  rowValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800"
  }
});
