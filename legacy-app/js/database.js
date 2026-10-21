(function createDatabaseAdapter() {
  const tableMap = Object.freeze({
    users: 'profiles',
    profiles: 'profiles',
    projects: 'projects',
    attendance: 'attendance',
    work: 'daily_work',
    dailyWork: 'daily_work',
    hardware: 'hardware',
    simHardware: 'sim_cards',
    simCards: 'sim_cards',
    notifications: 'notifications',
    materials: 'materials'
  });

  function client() {
    const backend = window.TeamOpsSupabase;
    if (!backend?.configured) throw new Error('Supabase is not configured.');
    return backend.client;
  }

  function applyFilters(request, filters = {}) {
    let query = request;
    Object.entries(filters).forEach(([field, value]) => {
      if (value === undefined || value === null || value === '') return;
      if (Array.isArray(value)) {
        query = query.in(field, value);
      } else if (typeof value === 'object') {
        if ('gte' in value) query = query.gte(field, value.gte);
        if ('lte' in value) query = query.lte(field, value.lte);
        if ('gt' in value) query = query.gt(field, value.gt);
        if ('lt' in value) query = query.lt(field, value.lt);
        if ('like' in value) query = query.ilike(field, value.like);
      } else {
        query = query.eq(field, value);
      }
    });
    return query;
  }

  function collection(name) {
    const table = tableMap[name] || name;
    return {
      async list(filters = {}, options = {}) {
        let query = client().from(table).select(options.select || '*');
        if (options.orderBy) {
          query = query.order(options.orderBy.field, { ascending: options.orderBy.ascending !== false });
        }
        if (options.limit) query = query.limit(options.limit);
        query = applyFilters(query, filters);
        const { data, error } = await query;
        if (error) throw error;
        return data || [];
      },
      async get(id, options = {}) {
        const { data, error } = await client()
          .from(table)
          .select(options.select || '*')
          .eq('id', id)
          .single();
        if (error) throw error;
        return data;
      },
      async create(record) {
        const { data, error } = await client().from(table).insert(record).select().single();
        if (error) throw error;
        return data;
      },
      async update(id, patch) {
        const { data, error } = await client().from(table).update(patch).eq('id', id).select().single();
        if (error) throw error;
        return data;
      },
      async upsert(record, key = 'id') {
        const { data, error } = await client().from(table).upsert(record, { onConflict: key }).select().single();
        if (error) throw error;
        return data;
      },
      async remove(id) {
        const { error } = await client().from(table).delete().eq('id', id);
        if (error) throw error;
      }
    };
  }

  const database = Object.freeze({
    configured: () => Boolean(window.TeamOpsSupabase?.configured),
    list: async (collectionName, filters = {}, options = {}) => collection(collectionName).list(filters, options),
    get: async (collectionName, id, options = {}) => collection(collectionName).get(id, options),
    create: async (collectionName, record) => collection(collectionName).create(record),
    update: async (collectionName, id, patch) => collection(collectionName).update(id, patch),
    remove: async (collectionName, id) => collection(collectionName).remove(id),
    profiles: collection('profiles'),
    projects: collection('projects'),
    dailyWork: collection('dailyWork'),
    attendance: collection('attendance'),
    materials: collection('materials'),
    hardware: collection('hardware'),
    simCards: collection('simCards'),
    notifications: collection('notifications')
  });

  window.TeamOpsDatabase = database;
})();
