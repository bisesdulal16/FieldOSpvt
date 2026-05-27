import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fontSize, spacing } from '../../constants';
import { useFieldOSStore } from '../../store/useFieldOSStore';

interface AppHeaderProps {
  title: string;
  showBack?: boolean;
  leftAction?: React.ReactNode;
  rightAction?: React.ReactNode;
}

export function AppHeader({ title, showBack, leftAction, rightAction }: AppHeaderProps) {
  const router = useRouter();
  const { toggleLanguage, language } = useFieldOSStore();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.leftContainer}>
        {leftAction ? (
          leftAction
        ) : showBack ? (
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={20} color={colors.gray700} />
          </TouchableOpacity>
        ) : (
          <View style={styles.logoContainer}>
            <View style={styles.logoBox}>
              <Text style={styles.logoText}>F</Text>
            </View>
            <Text style={styles.logoLabel}>FieldOS</Text>
            <Text style={styles.logoSublabel}>NEPAL</Text>
          </View>
        )}
        {showBack && <Text style={styles.titleText}>{title}</Text>}
      </View>
      <View style={styles.rightContainer}>
        <TouchableOpacity onPress={toggleLanguage} style={styles.langButton}>
          <Text style={styles.langButtonText}>
            {language === 'en' ? 'EN' : 'ने'} | {language === 'en' ? 'ने' : 'EN'}
          </Text>
        </TouchableOpacity>
        {rightAction}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray100,
  },
  leftContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  backButton: {
    padding: spacing.xs,
    marginLeft: -spacing.xs,
    borderRadius: 8,
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  logoBox: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    color: colors.white,
    fontSize: fontSize.md,
    fontWeight: 'bold',
  },
  logoLabel: {
    color: colors.navy,
    fontSize: fontSize.md + 1,
    fontWeight: 'bold',
  },
  logoSublabel: {
    color: colors.orange,
    fontSize: fontSize.sm,
    fontWeight: 'bold',
  },
  titleText: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.gray800,
  },
  rightContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  langButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: colors.gray300,
  },
  langButtonText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.gray400,
  },
});
