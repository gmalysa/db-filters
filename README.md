db-filters
==========

Filtering library for systematic database query generation using Node.js

## Overview

The purpose of db-filters is to provide an abstraction layer between data and the underlying database language. It provides a means for taking objects and then generating queries (eventually, for multiple database engines and families) automatically. Traditionally, a database abstraction layer would hide the API for interacting with the database behind a single API that can easily convert calls to support MySQL, PostgreSQL, SQLite, etc. However, SQL must still be written to send to these database, and it is not abstracted by the API.

db-filters fills this gap by providing an abstraction to the query language itself. In principle this allows for seamless migration between SQL and NoSQL solutions, but for now its primary purpose is to generate SQL statements programmatically with high consistency, safety (i.e. proper escaping), and simplicity, as compared to writing SQL by hand.

The premise of filtering data for query generation moves the task of translating object properties into database fields away from user code. Instead central rules are specified that can decode all of the object properties. This approach allows for simpler user code specifying what information is to be retrieved from a database, and it gracefully handles a complex combination of array types, optional values, and compound types that map to multiple fields or require additional preprocessing before being placed into an SQL query.

## Usage

**Note:** db-filters requires the mysql package. This is installed automatically by npm during the installation process, but you must first configure mysql before you can start issuing queries to your database. Additionally, you will supply a connection object to each filter prior to use; this will be discussed in more detail later.

### Setup

The first thing you must do to use db-filters is create a new filter, which contains a definition for a table in your database. For example,

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

This saves the new filter definition to the static variable db.filters, where it can be retrieved from in any other module. The automatic initialization can be invoked with ```db.init(path, log, log_level)```. Automatically generating filter definitions can be accomplished using the generate.js script included with db-filters. Invoke it from the command line for information on parameters and a guided tour:

```
$ cd db-filters
$ node generate
```

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

### select(where)

This creates a query that retrieves data from the database, naturally. The `where` parameter should be an object, where each key is either the name of a defined field for this table, or the name of a "special" field. The corresponding value for each key will be escaped and converted to the proper format for the column type, or it will be passed to the "special" handler, which is used to apply compound and/or complex rules on a single key. Values may be the result of operator functions as well as literals, such as {status : db.$neq(1)}, which will select rows where status != 1.

The special handler can emit zero or more entries, which is useful for aliasing multiple fields. For instance, in a many-to-many table that relates parents to children and identifies both by <id, type> pairs, it is convenient to define a "parent" special handler that maps the object to both a "parentId" and a "parentType" field, and an analogous handler for "child," which simplify the where clauses that you must supply from {parentId : parent.id, parentType : parent.type} to {parent : parent}, which is shorter to type and creates consistency in your application. Effectively, the special handlers provide a means to implement more sophisticated ORM.

Entries in the where parameter are processed according to type. If they are not an instance of a Conditional (which is produced by the db.$ functions defined in conditionals.js), then they are wrapped in one of db.$eq, db.$in, or db.$regex, depending on the type of javascript object supplied. If an operator is supplied, however, then it is evaluated, and its result is used in the WHERE clause. The operators perform input escaping and convert values to match the column type where appropriate.

A wide variety of db.$ functions are available to do additional processing. Generally, they are converted into their equivalent MySQL with appropriate field names and given parameters inserted, and are then executed by the MySQL server during the query, the same way as they would be if they were written by hand. However, this interface abstracts that aspect of SQL, allowing it to be transformed for use with another RDMS. I've made attempts to include most of the functions available to MySQL, but there are always gaps. There is a complete list of currently added db.$ functions farther down in the README file.

Once a select query has been created, it can be modified through many additional functions. These include ```limit()```, ```order()```, ```group()```, ```alias()```, and ```fields()```. Additionally, table joins are supported using the ```inner_join()```, ```left_join()```, and ```right_join()``` methods to specify filters to join to, ```on()``` to specify join conditions, and ```where()``` to specify filter parameters for joined tables. All of these methods may be chained to simplify user code. **Note:** Many functions take an optional first parameter to indicate which table the function applies to. If you do not wish to specify a table, DO NOT pass null or undefined. Simply skip the index parameter entirely.

```limit(mixed)``` limits the number of queries returned. If a single integer parameter is given, the select query will return at most that many rows. If an array is given, it will return at most mixed[1] rows starting at offset mixed[0].

```order([idx,] field [, field [ ... ]])``` specifies the order of results to be returned. It accepts a variable number of arguments. The optional first argument is a table index, indicating which table the rest of the columns belong to, in a join. If omitted, it defaults to 0, the primary table. The rest of the parameters are field names to include in the join. If you wish to sort in ascending or descending order, use ```db.$asc()``` and ```db.$desc()``` to wrap column names.

```group([idx,] field [, field [ ... ]])``` specifies which fields to group by in the results. Its behavior and argument structure is identical to ```order()```.

```alias([idx,] name)``` specifies an alias to use for this table in the result set. The idx parameter is optional and specifies which table is being aliased, defaulting to 0 for the primary table.

```fields([idx,] field [, field [ ... ]])``` specifies which fields should be retrieved by a query. The default is to include all fields from a table, if this method is never used. The first parameter is an optional table index, specifying which table's fields are being listed, in a JOIN statement. If omitted, it defaults to 0, the primary table.

```*_join(filter [, alias])``` creates a JOIN clause of the specified type, one of inner, left, or right. See the MySQL documentation for details on what each type of join does. It requires a table filter object and also accepts an optional table name alias to use in the resulting query.

```on([idx,] info [, info [, ... ]])``` specifies the conditions for a join and traditionally goes in the ON portion of the clause. This relates keys from two (or more) tables. Note that because ON statements are actually a part of a specific join, it is possible to have multiple calls to on() to specify the behavior for different joins, in a join involving three or more tables. It accepts a variable number of arguments. The first argument, which is optional, is an integer specifying which table join this on clause applies to, defaulting to the most recently added join table.

The remaining arguments are all arrays or objects. Each should have exactly two numerical keys, corresponding to tables in the query, and values corresponding to fields to relate together. Currently, all relationships are strict equality. This is best described by example.

```javascript
db.posts.select(...)
    .alias('p')
    .fields('id', 'threadId', 'userId')
    .left_join(db.filters.users, 'u')
    .fields(1, 'name', 'registered')
    .on(['userId', 'id'])
    .exec();
```

The query executed, then, would look something like "SELECT p.id, p.threadId, p.userId, u.name, u.registered FROM posts AS p LEFT JOIN users AS u ON p.userId = u.id ..." If three tables are included, and a relationship is to be established between the first and third tables, then the object form is more useful: on({0:'userId', 2:'id'}) to produce ON t0.`userId` = t2.`id`.

Finally, additional parameters can be supplied for the WHERE clause, relating to joined tables, by calling ```where(join, where)```. The where parameter works the same way as when generating the query, but the join parameter is an index indicating which table these conditions apply to. The default is 0, the primary table.

### insert(values)

Insert is used to insert values to the database. The values parameter is decoded in the same manner as the where parameter for the select statement, including support for both special columns and the use of db.$ functions. If you attempt to pass a conditional operator wrapping a value, you will receive a MySQL error, but no additional validity checking is done, so don't do this. Passing array types is also not supported, so currently one insert() call will produce one row in the database.

### update(values, where)

Update is used to modify values in the database. The values parameter is handled identically to values in an insert() call, with the same restrictions, and the where parameter is handled identically to the where parameter in select(), with no restrictions. update() also supports the use of .limit(), with the same parameters, to limit how many fields are updated

### delete(where)

Delete is used to delete values from the database. The where parameter functions identically to the where parameter to select(), with no restrictions. delete() also supports the use of .limit(), with the same parameters, to limit how many fields are updated.

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

### Select statements

Several examples of how to write select statements, broken down by function and/or common usage pattern.

#### Multiple functions in WHERE clause
```javascript
db.filters.users.select({name : req.name, password : db.$md5(db.$concat($db.field('salt'), req.password))})
    .limit(1)
    .exec();
```

produces something like this, with req.name = greg and req.password = password:

```
SELECT * FROM `users` WHERE name = 'greg' AND password = (MD5((CONCAT(`salt`, 'password')))) LIMIT 1
```

Note that there are some extraneous () in the query. These don't affect accuracy of execution, but they do look ugly, so hopefully they can be reduced in a future patch. Incidentally, this is a situation where a special handler might be useful. For instance, you could define a handler called salt_password, with a callback like so:

```javascript
function salt_password(key, value, terms, options) {
    value = db.md5(db.$concat(db.$field('salt'), value));
    terms.push(value.get('password', this, options));
}
```

Then, your query generation is changed to:

```javascript
db.filters.users.select({name : req.name, salt_password : req.password})
    .limit(1)
    .exec();
```

which is much simpler and creates consistency in the event that you needed to use the same types of conditions on that column in multiple places in your code.

#### Single table .fields()
```javascript
db..filters.users.select(...)
    .fields('id', 'name', 'email')
    .exec();
```

#### .join(), .on(), and .fields() in multiple tables
```javascript
db.filters.posts.select(...)
    .alias('p')
    .fields('id', 'threadId', 'userId')
    .left_join(db.filters.users, 'u')
    .fields(1, 'name', 'registered')
    .on(['userId', 'id'])
    .exec();
```

## Complete list of helpers

A complete list of the $-functions available for specifying operations on data. These generally correspond to mysql functions one-to-one. If a function takes multiple arguments, then when it is used in the where clause, the corresponding field name is used as the first argument, and a concrete value is used as the second. If you want/need to change this, use $raw to specify a concrete value and $field to properly wrap a field reference. Note that $field will replace the field in the body of the expression, so something like {id : db.$field('idx')} will produce `id` = `idx`, which is useful for comparing fields to computed functions of different fields.

```
$raw, $field, $eq, $neq, $gt, $ge, $lt, $le, $eq2, $neq2, $gt2, $ge2, $lt2, $in,
$in2, $not_in, $not_in2, $regex, $like, $not_regex, $not_like, $rand, $now,
$curdate, $curtime, $utc_date, $utc_time, $utc_timestamp, $count, $not,
$length, $char_length, $trim, $ltrim, $rtrim, $soundex, $reverse, $lcase, $ucase,
$bitcount, $abs, $acos, $asin, $atan, $ceil, $cos, $cot, $crc32, $degrees,
$exp, $floor, $ln, $log10, $log2, $radians, $round, $sign, $sin, $sqrt, $tan,
$md5, $sha1, $compress, $uncompress, $encrypt, $inet_aton, $inet_ntoa,
$left, $right, $repeat, $concat, $format, $atan2, $pow, $truncate, $round_to,
$aes_encrypt, $aes_decrypt, $des_encrypte, $des_decrypt, $encode,
$decode, $band, $bor, $bxor, $lshift, $rshift, $add, $sub, $mult, $div, $mod,
$asc, $desc
```

More functions may be added as necessary. If there is something you need that isn't listed, please open an issue or add it yourself and submit a pull request. If a new functional form is required (i.e. three arguments, or some of the awkward date syntax that comes up, etc.) I'd prefer an issue be opened so that we can plan the implementation better before just hacking in support for one function at a time.

The difference between $eq and $eq2 is that $eq locks the left side of the expression to the field name that it is used with, accepting only one argument. If you need to apply a function to the left side, use $eq2, which accepts two parameters and ignores the given column name. This can be useful for creating conditions in conjunction with GROUP BY statements, such as selecting only groups whose sum is greater than some threshold, and is frequently necessary when dealing with date objects.

## TODOs/Limitations

* There is no good way to specify cross-table relationships in WHERE clauses on multitable JOINs. This is something I'm investigating (suggestions are welcome) to implement in a manner that is consistent with the idea of presenting a simple, flexible, and powerful interface for assigning these types of constraints, but as of yet I don't have a way to reduce this to filtering operations. This means that the only cross-table relationships that are supported are strict equality in the ON clause.

* Combine fixed and free binary conditions into a single class, eliminate $*2 variants of conditional operators. We can do this by type guessing and including an if statement, and it will simplify the API.

* Allowing for an array of value sets to be passed to insert(), inserting multiple rows. This will rely on using a flow control library to execute a series of queries in sequence before calling either success or failure, so it will be implemented once flux-link has added looping constructs, because I am not interested in duplicating the functionality both here and there.

