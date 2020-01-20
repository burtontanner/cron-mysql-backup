# Cron Mysql Backup

The cron-mysql-backup module allows you to automate mysql backups on regular intervals. Mysql dump files will be placed 
in a directory of your choice. You will get confirmation emails as often as you would like. Emails will get sent anytime
something goes wrong (cannot connect to database etc.). Backups will never fill the entire disk space. The oldest ones
will be removed first

## Getting Started

Install cron-mysql-backup using npm:

```console
$ yarn add cron-mysql-backup
or 
$ npm install --save cron-mysql-backup
```

You will need a gmail account to send emails from. 

I wouldn't use your personal account.

After creating an account Go to : https://www.google.com/settings/security/lesssecureapps

Set the Access for less secure apps setting to Enabled (also why you shouldn't use a personal account)

## Usage

Import cron-mysql-backup and backup every hour on the hour:

```javascript
const cronMysqlBackup = require('cron-mysql-backup');

let options = {
    schedules: [{
        cronSchedule: "55 * * * *", // Hourly at XX:55.
        directory: './databaseName/hourly',
        maxBackups: 24
    }, {
        cronSchedule: "30 0 * * *",  // Daily at 12:30 a.m.
        directory: './databaseName/daily',
        maxBackups: 7
    }, {
        cronSchedule: "30 1 * * 0",  // Weekly Sunday at 1:30 a.m.
        directory: './databaseName/weekly',
        maxBackups: 4
    }, {
        cronSchedule: "0 3 1 * *",  // First Day of every month at 3:00 a.m.
        directory: './databaseName/monthly',
        maxBackups: 12
    }],
    connection: {
        host: 'database.ip.net',
        user: 'root',
        password: 'yourpassword',
        database: 'databaseName',
    },
    sendTo: 'steve@apple.com',
    sendFrom: 'backup@gmail.com',
    sendFromPassword: 'gmailPassword',
    sendDailyReportEmail: true,
};

cronMysqlBackup(options);
```

## PM2

Use a process manager to restart your process if it ever fails
https://www.npmjs.com/package/pm2

## Cron Syntax

This is a quick reference to cron syntax and also shows the options supported by cron-mysql-backup.

### Allowed fields

```
 # ┌────────────── second (optional)
 # │ ┌──────────── minute
 # │ │ ┌────────── hour
 # │ │ │ ┌──────── day of month
 # │ │ │ │ ┌────── month
 # │ │ │ │ │ ┌──── day of week
 # │ │ │ │ │ │
 # │ │ │ │ │ │
 # * * * * * *
```

### Allowed values

|     field    |        value        |
|--------------|---------------------|
|    second    |         0-59        |
|    minute    |         0-59        |
|     hour     |         0-23        |
| day of month |         1-31        |
|     month    |     1-12 (or names) |
|  day of week |     0-7 (or names, 0 or 7 are sunday)  |


### More Examples At
https://www.npmjs.com/package/node-cron
