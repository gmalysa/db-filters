db-filters
==========

Filtering library for systematic database query generation using Node.js

## Overview

The purpose of db-filters is to provide an abstraction layer between data and the underlying database language. It provides a means for taking objects and then generating queries (eventually, for multiple database engines and families) automatically. Traditionally, a database abstraction layer would hide the API for interacting with the database behind a single API that can easily convert calls to support MySQL, PostgreSQL, SQLite, etc. However, SQL must still be written to send to these databasee, and it is not abstracted by the API.

db-filters fills this gap by providing an abstraction to the query language itself. In principle this allows for seamless migration between SQL and NoSQL solutions, but for now its primary purpose is to generate SQL statements programmatically with high consistency, safety (i.e. proper escaping), and simplicity, as compared to writing SQL by hand.

The premise of filtering data for query generation moves the task of translating object properties into database fields away from user code. Instead central rules are specified that can decode all of the object properties. This approach allows for simpler user code specifying what information is to be retrieved from a database, and it gracefully handles a complex combination of array types, optional values, and compound types that should always map to multiple fields or require additional preprocessing before being placed into an SQL query.

Trivia: This was originally a PHP library that I wrote, but the code was very ugly. Now, a friend of mine is backporting the new Javascript version to PHP 5.3.

## Usage

```Note:``` db-filters requires the mysql package. This is installed automatically by npm during the installation process, but you must first configure mysql before you can start issuing queries to your database. Additionally, you will supply a connection object to each filter prior to use; this will be discussed in more detail later.

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
db.filters.users.select({status : 1})
    .exec(success_cb, failure_cb);
```

The success callback will have the result object returned from mysql, and the failure callback will have the error object. Each will only be supplied with a single argument.

Each of the filter methods (select, insert, update, and delete) returns a query object which supports several methods to adjust its parameters, and finally should be sent to the database by calling exec(). The methods available vary by query type and are described in further detail below.

### select()

### insert()

### update()

### delete()

### query()
Finally, the query method can be used to send raw queries that you write by hand to the database, but it should be avoided. This is used internally by exec() to send queries, but it is also available to user code in the event that an appropriate query cannot be created using the other methods, but of course this breaks the language abstraction and ties you to your database language and engine. If you're forced to use query(), but you think that it should be easy to generate the query, please post an issue for it, and then it might be added.

## Examples
