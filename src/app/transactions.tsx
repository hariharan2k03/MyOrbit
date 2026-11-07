import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Card, Chip, Divider, EmptyState, ListRow, QueryView, Screen, Text } from '@/components/ui';
import { listCategories, listExpenses } from '@/database/repositories/finance';
import { useQuery } from '@/services/useQuery';
import { spacing } from '@/theme/tokens';
import { formatCents, sumCents } from '@/utils/money';
import { formatDateKey } from '@/utils/time';

export default function TransactionsScreen() {
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const query = useQuery(
    async (db) => ({ expenses: await listExpenses(db, { search, categoryId, limit: 500 }), categories: await listCategories(db) }),
    [search, categoryId],
  );

  return (
    <>
      <Stack.Screen
        options={{
          headerSearchBarOptions: { placeholder: 'Search expenses', onChangeText: (e) => setSearch(e.nativeEvent.text), hideWhenScrolling: false },
        }}
      />
      <Screen largeTitle={false} onRefresh={() => void query.refresh()} refreshing={query.refreshing}>
        <QueryView query={query}>
          {({ expenses, categories }) => (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
                <Chip label="All" selected={categoryId === null} onPress={() => setCategoryId(null)} />
                {categories.map((c) => (
                  <Chip key={c.id} label={c.name} color={c.color} selected={categoryId === c.id} onPress={() => setCategoryId(c.id)} />
                ))}
              </ScrollView>
              <Text variant="footnote" tone="secondary">
                {expenses.length} {expenses.length === 1 ? 'expense' : 'expenses'} · {formatCents(sumCents(expenses.map((e) => e.amountCents)))}
              </Text>
              <Card>
                {expenses.length === 0 ? (
                  <EmptyState icon="magnifyingglass" title="No matching expenses" message="Try a different search or category." />
                ) : (
                  expenses.map((e, i) => (
                    <View key={e.id}>
                      {i > 0 ? <Divider /> : null}
                      <ListRow
                        icon={e.categoryIcon}
                        iconColor={e.categoryColor}
                        title={e.description}
                        subtitle={`${e.categoryName} · ${formatDateKey(e.spentDate, { weekday: true })}`}
                        value={formatCents(e.amountCents)}
                        onPress={() => router.push(`/expense/${e.id}`)}
                      />
                    </View>
                  ))
                )}
              </Card>
            </>
          )}
        </QueryView>
      </Screen>
    </>
  );
}
