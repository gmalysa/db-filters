db-filters
==========

Filtering library for systematic database query generation using Node.js

## Overview

The purpose of db-filters is to provide an abstraction layer between data and the underlying database language. It provides a means for taking objects and then generating queries (eventually, for multiple database engines and families) automatically. Traditionally, a database abstraction layer would hide the API for interacting with the database behind a single API that can easily convert calls to support MySQL, PostgreSQL, SQLite, etc. However, SQL must still be written to send to these database, and it is not abstracted by the API.

db-filters fills this gap by providing an abstraction to the query language itself. In principle this allows for seamless migration between SQL and NoSQL solutions, but for now its primary purpose is to generate SQL statements programmatically with high consistency, safety (i.e. proper escaping), and simplicity, as compared to writing SQL by hand.

The premise of filtering data for query generation moves the task of translating object properties into database fields away from user code. Instead central rules are specified that can decode all of the object properties. This approach allows for simpler user code specifying what information is to be retrieved from a database, and it gracefully handles a complex combination of array types, optional values, and compound types that should always map to multiple fields or require additional preprocessing before being placed into an SQL query.

## Usage

**Note:** db-filters requires the mysql package. This is installed automatically by npm during the installation process, but you must first configure mysql before you can start issuing queries to your database. Additionally, you will supply a connection object to each filter prior to use; this will be discussed in more detail later.

### Setup

The first thing you must do to use db-filters is create a new filter, which contains a definition for a table in your database (coming soon: automatic generator to provide initial definitions). For example,

```javascript
var db = require('db-filters');

var cols = {
id : db.int_t,
status : db.int_t,
name : [db.varchar_t, 64],
email : [db.varchar_t, 128],
registered : db.datetime_t,
last_login : db.datetime_t
};

var users = new db('users', cols, {});
```

We will ignore the third parameter to the constructor, `special`, for now, because it provides advanced functionality. Because table definitions are relatively static and should be separate from the rest of your code, db-filters provides a convenience initialization method. It accepts a path to a folder that (presumably) contains filter definitions, where each is a single node.js module that exports a single function, which is used to create and save the filter. For example, our above filter would be implemented as:

```javascript
module.exports = function(db) {
var cols = {
id : db.int_t,
status : db.int_t,
name : [db.varchar_t, 64],
email : [db.varchar_t, 128],
registered : db.datetime_t,
last_login : db.datetime_t
};

db.add_filter('users', new db('users', cols, {}));
};
```

This saves the new filter definition to the static variable db.filters, where it can be retrieved from in any other module. The automatic initialization can be invoked with ```db.init(path, log, log_level)```

Once a filter has been created, it supports four primary operations: select, insert, update, and delete. Additionally, a connection object (from mysql) must be assigned to the filter prior to executing queries on it. This connection should already be configured for the proper database; personally I use a separate wrapper to manage my mysql connection pool and supply preconfigured connections to db-filters, but if it seems reasonable, some of this interface might be included in a future release.

Thus, to use our new filter to select all users with status set to 1, the code looks like this:

```javascript
// conn already initialized from node-mysql
db.filters.users.set_conn(conn);
db.filters.users.select({status : 1})
    .exec(success_cb, failure_cb);
```

The success callback will have the result object returned from mysql, and the failure callback will have the error object. Each will only be supplied with a single argument.

Each of the filter methods (select, insert, update, and delete) returns a query object which supports several methods to adjust its parameters, and finally should be sent to the database by calling exec(). The methods available vary by query type and are described in further detail below.

### select(where, negate)

This creates a query that retrieves data from the database, naturally. The two parameters define what type of data is retrieved. `where` is mandatory, but it may be given as an empty object, {}, but `negate` is optional and defaults to []. The `where` parameter should be a key-value object, where each key is either the name of a defined field for this table, or the name of a "special" field. The corresponding value for each key will be escaped and converted to the proper format for the column type, or it will be passed to the "special" handler, which is more flexible.

The special handler can emit zero or more entries, which is useful for aliasing multiple fields. For instance, in a many-to-many table that relates parents to children and identifies both by <id, type> pairs, it is convenient to define a "parent" special handler that maps the object to both a "parentId" and a "parentType" field, and an analogous handler for "child." It can also be used to extend the simplistic matching behavior, replacing it with with more complex behavior, such as password hashing or salting.

When the entries in the `where` parameter are processed, each will be converted to the format ```key = value```, with proper escaping or type conversion based on the type of the field. If an array is supplied, rather than a primitive type, a condition of the form ```key IN (index 0 [, index 1 [, ...]])``` for all entries in the array.

Additionally, if a RegExp instance is supplied for a text-type field, it will instead produce ```key REGEX "regex"```, rather than an equality test. Similarly, if an instance of db.Like is supplied, it will produce ```key LIKE "pattern"``` as well. This behavior may be expanded in the future, but currently only strict equality, IN(), REGEX, and LIKE are generated as part of a WHERE clause.

Finally, the `negate` parameter is used to invert relationships. Any key present in the `negate` array will have its corresponding key/value pair in the `where` parameter produce a negative condition, i.e. !=, NOT IN(), NOT REGEX, NOT LIKE, etc.

Once a select query has been created, it can be modified through many additional functions. These include ```limit()```, ```order()```, ```group()```, and ```fields()```. Additionally, table joins are supported using the ```join()``` method to specify filters to join to, ```on()``` to specify join conditions, and ```where()``` to specify filter parameters for joined tables. All of these methods may be chained to simplify user code.

```limit()``` limits the number of queries returned. If a single integer parameter is given, the select query will return at most that many rows. If an array is given, it will return at most array[1] rows starting at offset array[0].

```order()``` specifies the order of results to be returned. Its only parameter is an array of field names to order by. If a non-default ordering (such as ascending or descending being set explicitly) is required, then each entry in the array should be an array, with the 0th index storing the field name, and the 1st index storing either ASC or DESC to specify the ordering. **NOTE:** This function will change in v0.1.2 as part of the function abstraction implementation.

```group()``` specifies which fields to group by in the results. Its only parameter is an array of field names to group by. Like `order()`, `group()` will undergo significant improvements in v0.1.2 and its parameters are likely to change format.

```fields()``` specifies which fields should be retrieved by a query and also allows for table aliases to be specified. The default is * for SQL statements, meaning all fields. If this is undesirable, call fields. It accepts either two arguments as ```fields(fields, alias)``` or ```fields(join, fields, alias)```. The fields parameter should be an array of field names. The alias parameter is optional, and if specified will rename the table in question, with regard to this query. Aliases are only emitted in the query itself for JOIN queries. If the first parameter, join, is specified, it is the index of JOINed table whose fields are specified, starting with 0 for the first JOINed table. This is best explained by example:

```javascript
db.users.select(...)
    .fields(['id', 'name', 'email'])
    .exec()
```

will retrieve only the id, name, and email of all users in the table. In a join, with another table "posts" whose definition is omitted, you might write this instead:

```javascript
db.posts.select(...)
    .fields(['id', 'threadId', 'userId'], 'p')
    .join(db.users, 'LEFT')
    .fields(0, ['name', 'registered'], 'u')
    .on(['userId', 'id'])
    .exec();
```

which would return an object with keys p.id, p.threadId, p.userId, u.name, and u.registered, where u.id == p.userId. The syntax for ```join()``` and ```on()``` will be explained in a moment.

```join()``` is used to create multitable JOIN queries by combining filters. It accepts two parameters: the first specifies which filter to join to, and the second specifies the type of join. If the type is omitted, it will default to an INNER JOIN, because an INNER JOIN does not require an on() clause to be specified. The first argument may optionally be an array, in which case array[0] should be the filter instance, and array[1] is the alias to use for the joined table. The alias for the joined table may also be specified with a call to ```fields()```. The parameters for `join()` will likely undergo minor changes in v0.1.2.

```on()``` specifies the conditions for a join and traditionally goes in the ON portion of the clause. This relates keys from two (or more) tables. Note that because ON statements are actually a part of a specific join, it is possible to have multiple calls to on() to specify the behavior for different joins, in a join involving three or more tables. It accepts a variable number of arguments. The first argument, which is optional, is an integer specifying which join this on clause applies to.

The remaining arguments are all arrays or objects. Each should have exactly two numerical keys, corresponding to tables in the query, and values corresponding to fields to relate together. Currently, all relationships are strict equality. This is again best specified by example. For the earlier join,

```javascript
db.posts.select(...)
    .fields(['id', 'threadId', 'userId'], 'p')
    .join(db.users, 'LEFT')
    .fields(0, ['name', 'registered'], 'u')
    .on(['userId', 'id'])
    .exec();
```

we'd see something along the lines of LEFT JOIN `users` AS `u` ON `p`.`userId` = `u`.`id`. If three tables are included, and a relationship is to be established between the first and third tables, then the object form is more useful: on({0:'userId', 2: 'id'}) to produce ON t0.`userId` = t2.`id`. The parameters for `on()` will likely undergo minor changes for v0.1.2.

Finally, additional parameters can be supplied for the WHERE clause, relating to joined tables, by calling ```where(join, where, negate)```. The where and negate parameters are the same as described earlier, but the join parameter is an index indicating which joined filter this set of conditions applies to.

### insert(values)

### update(values, where, negate)

### delete(where, negate)

### query(sql, success_cb, failure_cb)
Finally, the query method can be used to send raw queries that you write by hand to the database, but it should be avoided. This is used internally by exec() to send queries, but it is also available to user code in the event that an appropriate query cannot be created using the other methods, but of course this breaks the language abstraction and ties you to your database language and engine. If you're forced to use query(), but you think that it should be easy to generate the query, please post an issue for it, and then it might be added.

## Other Useful Functions

The global db object also has some useful functions. These exist to simplify the process of managing filter instances and helping to maintain separation between requests.

### db.clone_filters()

Each filter should only be used to handle a single (or small number of) request, because it tracks statistics on queries issued, so if you use it for your entire site, the memory usage will eventually consume all system ram (maybe query tracking should be opt-in, rather than always on, since production sites probably don't care about this behavior...). Therefore, you should use db.clone_filters() to generate a copy of all of the defined filters for your request.

### db.set_conn_all(conn, filters)

This exists as a convenience method to set the given connection on all filter instances in the filters argument (not the global list of filter templates).

### instance.clone()

This returns a clone of the filter instance; that is, one that has the same table name, column definitions, and special handler capabilities, but does not share any (mutable) state with the original. This function is used internally by db.clone_filters(), and if you don't want to clone all of your filters at once, you can use it too.

## Examples

## TODOs

Currently, select.order() and select.group() do not allow specifying fields from joined tables in the order by or group by clauses. This will be addressed in v0.1.2, and these functions will see significant changes to how they behave.

Specifying functions of fields is not supported (i.e. will produce garbage SQL) for multitable JOINs, because it will attempt to prefix the table name onto the "field name" that actually consists of a function wrapping a field. An abstraction for functions will be introduced (eventually) to resolve this issue, hopefully in v0.1.2 or v0.1.3.

select.join() and select.on() need to be improved to accept parameters with better formatting. Possibly introduce aliases for left, inner, and right joins in order to simplify usage in user code.

Poor consistency for table numbering between where(), fields(), on(), etc. This needs to be made uniform, so that index 0 is always the primary table and index 1 is the first joined table, where currently 0 is sometimes the primary table and sometimes it is the first joined table.

Complex relationships in WHERE conditions (or in SET clauses) are not supported. That is, you couldn't generate a query like "SET `count` = `count` + 1," nor could you produce something like "WHERE SUM(income) > threshold" without using a special handler. The latter will be resolved by a combination of introducing function abstractions as well as a scheme for generalizing the types of relationships to generate for key/value pairs (the goal here is simplicity of user code and reasonable abstractions, so simply slapping on more options, especially SQL-specific ones, to do this is suboptimal). The former is postponed until a reasonable approach presents itself.

There is no good way to specify cross-table relationships in WHERE clauses on multitable JOINs. This is something I'm investigating (suggestions are welcome) to implement in a manner that is consistent with the idea of presenting a simple, flexible, and powerful interface for assigning these types of constraints, but as of yet I don't have a way to reduce this to filtering operations. This means that the only cross-table relationships that are supported are strict equality in the ON clause.


