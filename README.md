db-filters
==========

Filtering library for systematic database query generation using Node.js

## Overview

The purpose of db-filters is to provide an abstraction layer between data and the underlying database language. It provides a means for taking objects and then generating queries (eventually, for multiple database engines and families) automatically. Traditionally, a database abstraction layer would hide the API for interacting with the database behind a single API that can easily convert calls to support MySQL, PostgreSQL, SQLite, etc. However, SQL must still be written to send to these database, and it is not abstracted by the API.

db-filters fills this gap by providing an abstraction to the query language itself. In principle this allows for seamless migration between SQL and NoSQL solutions, but for now its primary purpose is to generate SQL statements programmatically with high consistency, safety (i.e. proper escaping), and simplicity, as compared to writing SQL by hand.

The premise of filtering data for query generation moves the task of translating object properties into database fields away from user code. Instead central rules are specified that can decode all of the object properties. This approach allows for simpler user code specifying what information is to be retrieved from a database, and it gracefully handles a complex combination of array types, optional values, and compound types that should always map to multiple fields or require additional preprocessing before being placed into an SQL query.

## Usage

''Note:'' db-filters requires the mysql package. This is installed automatically by npm during the installation process, but you must first configure mysql before you can start issuing queries to your database. Additionally, you will supply a connection object to each filter prior to use; this will be discussed in more detail later.

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

We will ignore the third parameter to the constructor, ```special```, for now, because it provides advanced functionality. Because table definitions are relatively static and should be separate from the rest of your code, db-filters provides a convenience initialization method. It accepts a path to a folder that (presumably) contains filter definitions, where each is a single node.js module that exports a single function, which is used to create and save the filter. For example, our above filter would be implemented as:

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

db.filters.users = new db('users', cols, {});
};
```

This saves the new filter definition to the static variable db.filters, where it can be retrieved from in any other module. The automatic initialization can be invoked with ```db.init(path, log, log_level)```

Once a filter has been created, it supports four primary operations: select, insert, update, and delete. Additionally, a connection object (from mysql) must be assigned to the filter prior to executing queries on it. This connection should already be configured for the proper database; personally I use a separate wrapper to manage my mysql connection pool and supply preconfigured connections to db-filters, but if it seems reasonable, some of this interface might be included in a future release.

Thus, to use our new filter to select all users with status set to 1, the code looks like this:

```javascript
// conn already initialized and has database set properly
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

```order()```

### insert(values)

### update(values, where, negate)

### delete(where, negate)

### query(sql, success_cb, failure_cb)
Finally, the query method can be used to send raw queries that you write by hand to the database, but it should be avoided. This is used internally by exec() to send queries, but it is also available to user code in the event that an appropriate query cannot be created using the other methods, but of course this breaks the language abstraction and ties you to your database language and engine. If you're forced to use query(), but you think that it should be easy to generate the query, please post an issue for it, and then it might be added.

## Examples

## TODOs

Currently, select.order() and select.group() do not allow specifying fields from joined tables in the order by or group by clauses. This will be addressed in v0.1.2.

Specifying functions of fields is not supported (i.e. will produce garbage SQL) for multitable JOINs, because it will attempt to prefix the table name onto the "field name" that actually consists of a function wrapping a field. An abstraction for functions will be introduced (eventually) to resolve this issue, hopefully in v0.1.2 or v0.1.3.

Complex relationships in WHERE conditions (or in SET clauses) are not supported. That is, you couldn't generate a query like "SET `count` = `count` + 1," nor could you produce something like "WHERE SUM(income) > threshold" without using a special handler. The latter will be resolved by a combination of introducing function abstractions as well as a scheme for generalizing the types of relationships to generate for key/value pairs (the goal here is simplicity of user code and reasonable abstractions, so simply slapping on more options, especially SQL-specific ones, to do this is suboptimal).

There is no good way to specify cross-table relationships in WHERE clauses on multitable JOINs. This is something I'm investigating (suggestions are welcome) to implement in a manner that is consistent with the idea of presenting a simple, flexible, and powerful interface for assigning these types of constraints, but as of yet I don't have a way to reduce this to filtering operations. This means that the only cross-table relationships that are supported are strict equality in the ON clause.


