/**
 * Definition of the Query-related classes that are used by each filter
 * to actually generate SQL statements
 *
 * (c) 2013, Greg Malysa <gmalysa@stanford.edu>
 * Permission to use governed by the terms of the MIT license. See LICENSE for details
 */

var _ = require('underscore');
var mysql = require('mysql');

/**
 * Class that wraps a table definition, mostly just for simplicity
 * @param filter The db instance that defines the filter used for this table
 * @param options Hash of options for use with some filter methods
 * @param joinType Optional information about using this table in a JOIN
 */
function TableInfo(filter, options, joinType) {
	this.filter = filter;
	this.options = options;
	this.type = (joinType === undefined) ? '' : joinType;
	this.on = [];
	this.fields = [];
	this.where = {};
	this.order = [];
	this.group = [];
}

/**
 * Query class used to make the interface make more logical sense
 * @param filter The db filter instance that defines the table this query acts on
 */
function Query(filter) {
	this._tables = [new TableInfo(filter, {useName : false, alias : ''})];
	this._limit = [];					//!< List of limit parameters
	this._options = {};
}

/**
 * Default, "not supported" method. This doesn't throw an error, because that'd break
 * user callback chains in a really annoying way, but it will log to the filter's logging
 * mechanism, which can be helpful for tracking down errors.
 */
function not_supported() {
	db.log(db.l_error, 'This function (' + arguments.callee + ') is not implemented for ' + this.constructor.name);
}

// Add member functions to the query definition
_.extend(Query.prototype, {
	/**
	 * These three exist for the SELECT query only, so we don't provide global implementations
	 */
	group : not_supported,
	fields : not_supported,
	order : not_supported,

	/**
	 * How each query is built depends on the type of query, so we must defer that to the implementing subclass
	 */
	buildQuery : not_supported,

	/**
	 * Helper function to pass additional options to the sql driver. This is essentially abstraction
	 * breaking, but the most common option for node-mysql will be nestTables, which we can support
	 * ourselves later and fake or ignore for other drivers
	 */
	options : function(options) {
		this._options = _.extend(this._options, options);
		return this;
	},

	/**
	 * Helper function that retrieves the where clause using the specified db filter to aid in construction
	 * @return String verbatim WHERE clause, will be empty if there are no restrictions
	 */
	getWhere : function() {
		return this._tables[0].filter.where(this._tables[0].where, this._tables[0].options);
	},

	/**
	 * Helper function that turns the _limit array into a useful limit statement (used in 3 of 4 queries)
	 * @return String verbatim LIMIT statement, will be empty if no limits specified
	 */
	getLimit : function() {
		if (this._limit.length > 0) {
			return ' LIMIT ' + this._limit.join(', ');
		}
		return '';
	},

	/**
	 * We provide a default implementation for limit because it is used by three of the four queries that
	 * are provided, so this reduces repetition. Formal parameters are limit([offset,] count)
	 * @param varargs One or two arguments as described above, to specify the query limits
	 * @return Chainable this pointer
	 */
	limit : function(limits) {
		this._limit = [arguments[0]];
		if (arguments.length == 2)
			this._limit[1] = arguments[1];
		return this;
	},

	/**
	 * We also provide a default implementation for where, because again it is used by three of the four
	 * queries that are provided, thereby reducing repetition.
	 * @param where Key/value mapping, suitable for filter decoding, to be used for WHERE generation
	 * @return Chainable this pointer
	 */
	where : function(where) {
		this._tables[0].where = where || {};
		return this;
	},
	
	/**
	 * Executes the query, calling methods that must be implemented in order to produce the
	 * query string, and then retrieving the connection object from the db filter given
	 * @param success Callback to invoke on success, with one argument, the results
	 * @param failure Callback to invoke on failure, with one argument, the error object
	 */
	exec : function(success, failure) {
		var query = this.buildQuery();
		this._tables[0].filter.query(_.extend({sql : query}, this._options), success, failure);
	}
});

/**
 * DeleteQuery is used to construct a DELETE statement. It is simple and defines no additional
 * interface over the base Query class
 * @param filter The database filter to use for computing WHERE statements
 */
DeleteQuery.prototype = new Query();
function DeleteQuery(filter, where) {
	Query.call(this, filter);
	this.where(where);
}

// Inherit/copy methods from Query, and then fill in how to build a DELETE query
DeleteQuery.prototype.constructor = DeleteQuery;
_.extend(DeleteQuery.prototype, {
	/**
	 * Builds the final query that is sent to SQL
	 * @return String SQL query
	 */
	buildQuery : function() {
		return 'DELETE FROM ' + this._tables[0].filter.table + this.getWhere() + this.getLimit();
	}
});

/**
 * InsertQuery is used to construct an INSERT statement. It too is very simple, but it must
 * undefine the where and limit interfaces. The values to insert are specified in the constructor,
 * using the same decoding features as a where clause would normally do
 * @param filter The database filter to use for decoding the values
 * @param values The values to insert when this query is executed
 */
InsertQuery.prototype = new Query();
function InsertQuery(filter, values) {
	Query.call(this, filter);
	this.values = values;
}

// Inherit/copy methods from Query, and then fill in how to build an INSERT query
InsertQuery.prototype.constructor = InsertQuery;
_.extend(InsertQuery.prototype, {
	/**
	 * Remove the unsuitable methods
	 */
	where : not_supported,
	limit : not_supported,

	/**
	 * Builds the final query that is sent to SQL
	 * @return String SQL query
	 */
	buildQuery : function() {
		return 'INSERT INTO ' + this._tables[0].filter.table + this._tables[0].filter.set(this.values);
	}
});

/**
 * An UpdateQuery is used to build UPDATE queries. It is simple, but it must make two filter
 * decodings, one for the values and the other for the WHERE clause
 * @param filter The database filter to use for decoding values
 * @param values The new values to be written in place
 * @param where The update criteria
 */
UpdateQuery.prototype = new Query();
function UpdateQuery(filter, values, where) {
	Query.call(this, filter);
	this.values = values;
	this.where(where);
}

// Inherit/copy methods from Query and then fill in how to build an UPDATE query
UpdateQuery.prototype.constructor = UpdateQuery;
_.extend(UpdateQuery.prototype, {
	/**
	 * Builds the final query that is sent to SQL
	 * @return String SQL query
	 */
	buildQuery : function() {
		return 'UPDATE ' + this._tables[0].filter.table + this._tables[0].filter.set(this.values) + this.getWhere() + this.getLimit();
	}
});

/**
 * SelectQuery is used to construct a SELECT statement
 * @param filter The database filter used to help construct this query
 * @param where The where object for this filter
 * @param alias Optional alias for the primary table, to avoid having to specify it later
 */
SelectQuery.prototype = new Query();
function SelectQuery(filter, where, alias) {
	Query.call(this, filter);
	this.where(where);
	this._tables[0].options.alias = alias || '';
}

// Inherit/copy all of the methods from Query, and then fill in the ones we need to change
SelectQuery.prototype.constructor = SelectQuery;
_.extend(SelectQuery.prototype, {
	/**
	 * Select uses a special where option that allows things to be specified per join index
	 * @param idx The joined table number. The first joined table is index 0
	 * @param where Key/value mapping, suitable for filter decoding, to be used for WHERE generation
	 * @return Chainable this pointer
	 */
	where : function(idx, where) {
		if (typeof idx != 'number') {
			where = arguments[0];
			idx = 0;
		}
		this._tables[idx].where = where || {};
		return this;
	},

	/**
	 * Accept parameters to be used for the GROUP BY clause
	 * @param idx Joined table index, optional, defaults to 0 (primary table) that contains the fields
	 * @param varargs list of fields to group by, or one array of a list of fields
	 * @return Chainable this pointer
	 */
	group : function() {
		var i = 1;
		var idx = arguments[0];

		if (typeof idx != 'number') {
			idx = 0;
			i = 0;
		}

		for (; i < arguments.length; ++i) {
			if (_.isArray(arguments[i]))
				Array.prototype.push.apply(this._tables[idx].group, arguments[i]);
			else
				this._tables[idx].group.push(arguments[i]);
		}

		return this;
	},

	/**
	 * Sets the alias for this table or a joined table
	 * @deprecated, Use alias options in constructor and join calls
	 * @param join Join index, optional, will apply the alias to this joined table
	 * @param alias The string alias to use for this table in the query
	 * @return Chainable this pointer.
	 */
	alias : function(join, alias) {
		if (typeof join != 'number') {
			alias = arguments[0];
			join = 0;
		}
		this._tables[join].options.alias = alias || '';
		return this;
	},

	/**
	 * Accept a list of fields that should be used for the select query. Fields may be included
	 * with an optoinal alias as well, which should be specified as an array in that case.
	 * @param join Join index, optional, will apply these field selections to the given join
	 * @param varargs, each is processed as a single field, whether literal or array type
	 * @return Chainable this pointer
	 */
	fields : function() {
		var i = 1;
		var join = arguments[0];
		
		if (typeof join != 'number') {
			join = 0;
			i = 0;
		}

		for (; i < arguments.length; ++i) {
			this._tables[join].fields.push(arguments[i]);
		}

		return this;
	},

	/**
	 * Accepts a list of things for the order by clasue. To specify direction, use $db.asc and $db.desc.
	 * @param idx Join table index, defaults to 0 (primary table)
	 * @param varargs order by terms to add, one field per additional argument, or one array as the first argument
	 * @return Chainable this pointer
	 */
	order : function() {
		var i = 1;
		var idx = arguments[0];

		if (typeof idx != 'number') {
			idx = 0;
			i = 0;
		}

		for (; i < arguments.length; ++i) {
			if (_.isArray(arguments[i]))
				Array.prototype.push.apply(this._tables[idx].order, arguments[i]);
			else
				this._tables[idx].order.push(arguments[i]);
		}

		return this;
	},

	/**
	 * Add another table to this query as part of an inner join
	 * @param filter The filter representing the table to add
	 * @param alias The alias for the joined table in the query, optional
	 * @return Chainable this pointer
	 */
	inner_join : function(filter, alias) {
		alias = alias || '';
		this._tables.push(new TableInfo(filter, {useName : true, alias : alias}, 'INNER'));
		this._tables[0].options.useName = true;
		return this;
	},

	/**
	 * Adds another table to this query as part of a left join
	 * @param filter The filter representing the table to add
	 * @param alias The alias for the joined table in the query, optional
	 * @return Chainable this pointer
	 */
	left_join : function(filter, alias) {
		alias = alias || '';
		this._tables.push(new TableInfo(filter, {useName : true, alias : alias}, 'LEFT'));
		this._tables[0].options.useName = true;
		return this;
	},

	/**
	 * Adds another table to this query as part of a right join
	 * @param filter The filter representing the table to add
	 * @param alias The alias for the joined table in the query, optional
	 * @return Chainable this pointer
	 */
	right_join : function(filter, alias) {
		alias = alias || '';
		this._tables.push(new TableInfo(filter, {useName : true, alias : alias}, 'RIGHT'));
		this._tables[0].options.useName = true;
		return this;
	},

	/**
	 * Specifies the ON condition for the join. Each argument is taken as a pair of conditions and
	 * should be an object whose key indicates the numerical index of the table and whose value is the
	 * field to be specified. For instance, on(['id', 'userId']) would specify one ON clause comparing
	 * t0.id to t1.userId. Mutliple conditions can be chained with successive calls to on() or by passing
	 * them as additional parameters
	 * @param join Integer join number to apply this on to, optional. Defaults to the latest added.
	 * @param varargs, Each is an array of ON details
	 * @return Chainable this pointer
	 */
	on : function() {
		var join = arguments[0];
		var i = 1;

		if (typeof join != 'number') {
			join = this._tables.length - 1;
			i = 0;
		}

		for (; i < arguments.length; ++i) {
			this._tables[join].on.push(arguments[i]);
		}

		return this;
	},

	/**
	 * Gets this query's table name, accounting for aliasing. If index is omitted, the alias is
	 * returned for the primary table, otherwise it is the idx-th joined table.
	 * @param idx Index of the table whose alias we would like to retrieve
	 * @return String table name or alias
	 */
	getTableAlias : function(idx) {
		var t = this._tables[idx];
		if (t.options.alias.length > 0)
			return t.options.alias;
		return t.filter.table;
	},

	/**
	 * Update the getWhere() method to support concatenating where clauses from tables that are
	 * joined onto this query. This means we have to call decode filter directly, rather than using
	 * the convenience wrapper, because we're reimplementing that on a higher level
	 * @return WHERE clause that can be concatenated immediately
	 */
	getWhere : function() {
		var wheres = [];
		this._tables.forEach(function(v) {
			var w = v.filter.decode_filter(v.where, ' AND ', v.options);
			if (w.length > 0)
				wheres.push(w);
		});

		var where = wheres.join(' AND ');
		if (where.length > 0)
			return ' WHERE ' + where;
		return '';
	},

	/**
	 * Returns the group by clause or an empty string if one isn't present
	 * @return String the GROUP BY part of this select statement
	 */
	getGroupBy : function() {
		var groups = [];
		this._tables.forEach(function(v) {
			var internalGroup = v.group.map(function(g) {
				return v.filter.escapeKey(g, v.options);
			}).join(', ');

			if (internalGroup.length > 0)
				groups.push(internalGroup);
		});

		if (groups.length > 0)
			return ' GROUP BY ' + groups;
		return '';
	},

	/**
	 * Returns the order by clause or an empty string if one isn't present
	 * @return String the ORDER BY part of this select statement
	 */
	getOrderBy : function() {
		//Faster version without function calls--is it worth it for less clarity?
		//var order = '';
		//for (var t = 0; t < this._tables.length; ++t) {
		//	var table = this._tables[t];
		//	if (table.order[0]) {
		//		var internalOrder = table.filter.escapeKey(table.order[0], table.options);
		//	
		//		for (var i = 1; i < table.order.length; ++i) {
		//			internalOrder += ', ' + table.filter.escapeKey(table.order[i], table.options);
		//		}
		//	}
		//}

		var order = [];
		this._tables.forEach(function(v) {
			var internalOrder = v.order.map(function(o) {
				return v.filter.escapeKey(o, v.options);
			}).join(', ');

			if (internalOrder.length > 0)
				order.push(internalOrder);
		});

		if (order.length > 0)
			return ' ORDER BY ' + order;
		return '';
	},

	/**
	 * Returns the fields, or * if no fields were specified for one table. Also supports
	 * renaming fields if they are passed as an array
	 * @param table A TableInfo instance that describes the table to get fields for
	 * @return String the fields
	 */
	getTableFields : function(table) {
		if (table.fields.length > 0) {
			return table.fields.map(function(v) {
				if (_.isArray(v))
					return table.filter.escapeKey(v[0], table.options) + ' AS ' + v[1];
				return table.filter.escapeKey(v, table.options);
			}).join(', ');
		}

		return table.filter.escapeKey('*', table.options);
	},

	/**
	 * Returns the fields used for this query. Combines field selections from all tables
	 * that are joined together, retrieving fields for each one. If we're not doing a join,
	 * then the table alias is left off of the fields, because it is unnecessary
	 * @return Complete fields listing for this query
	 */
	getFields : function() {
		return this._tables.map(this.getTableFields, this).join(', ');
	},

	/**
	 * Retrieves the ON clause that comes up in a join expression
	 * @param tables The names of the tables indexed in the proper order for inclusion
	 * @return String the ON clause, empty if there isn't a join happening
	 */
	getOnClause : function(on, tables) {
		if (on.length > 0) {
			// Probably the most functional-ish piece of code I've ever written
			// Map each _on entry to ... and separated by a ,
			return ' ON ' + on.map(function(v) {
				// its values mapped to ... and separated by an =
				return _.map(v, function(v, k) {
					// the table name for the key and the escaped identifier
					return mysql.escapeId(tables[k]) + '.' + mysql.escapeId(v);
				}).join(' = ');
			}).join(' AND ');

			// I.e. this turns [['id', 'userId'], {0:'id', 2:'adminId'}] into
			// ON t0.`id` = t1.`userId`, t0.`id` = t2.`adminId`
		}
		return '';
	},

	/**
	 * Returns the table name portion of the select statement, which will either be
	 * just the one table, or expand to include all the proper subclauses for the
	 * join statement
	 * @return String table name portion of query
	 */
	getTableNameClause : function() {
		// Need a list of all table names before going into join clause generation
		var tableNames = this._tables.map(function(v, k) {
			return this.getTableAlias(k);
		}, this);

		// Combine table names, join parameters, and on clauses
		return this._tables.map(function(v) {
			var name = v.filter.table + (v.options.alias.length > 0 ? ' AS ' + v.options.alias : '');
			if (v.type.length > 0)
				name = v.type + ' JOIN ' + name + this.getOnClause(v.on, tableNames);
			return name;
		}, this).join(' ');
	},
	
	/**
	 * Builds the final query that is sent to SQL
	 * @return String SQL query
	 */
	buildQuery : function() {
		return 'SELECT ' + this.getFields() + ' FROM ' + this.getTableNameClause() + this.getWhere() + this.getGroupBy() + this.getOrderBy() + this.getLimit();
	}
	
});

// Export the concrete query class definitions
module.exports.SelectQuery = SelectQuery;
module.exports.InsertQuery = InsertQuery;
module.exports.UpdateQuery = UpdateQuery;
module.exports.DeleteQuery = DeleteQuery;
