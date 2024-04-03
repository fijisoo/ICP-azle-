import {v4 as uuidv4} from "uuid";
import {Err, ic, Ok, Opt, query, Record, Result, Server, StableBTreeMap, text, update, Variant, Vec,} from "azle";
import express from "express";

/**
 * `messagesStorage` - it's a key-value datastructure that is used to store messages.
 * {@link StableBTreeMap} is a self-balancing tree that acts as a durable data storage that keeps data across canister upgrades.
 * For the sake of this contract we've chosen {@link StableBTreeMap} as a storage for the next reasons:
 * - `insert`, `get` and `remove` operations have a constant time complexity - O(1)
 * - data stored in the map survives canister upgrades unlike using HashMap where data is stored in the heap and it's lost after the canister is upgraded
 *
 * Brakedown of the `StableBTreeMap(string, Message)` datastructure:
 * - the key of map is a `messageId`
 * - the value in this map is a message itself `Message` that is related to a given key (`messageId`)
 *
 * Constructor values:
 * 1) 0 - memory id where to initialize a map.
 */

/**
 This type represents a message that can be listed on a board.
 */
class Message {
    id: string;
    title: string;
    body: string;
    attachmentURL: string;
    createdAt: string;
    updatedAt: string | null;
}

const MessageIType = Record({
    id: text,
    title: text,
    body: text,
    attachmentURL: text,
    createdAt: text,
    updatedAt: text,
});

const messagesStorage = StableBTreeMap<string, Message>(0);

const Error = Variant({
    NotFound: text,
    InvalidPayload: text,
    DataExist: text,
});

function getCurrentDate() {
    const timestamp = new Number(ic.time());
    return new Date(timestamp.valueOf() / 1000_000);
}

export default Server<any>(
    () => {
        const app = express();
        app.use(express.json());

        app.post("/messages", (req, res) => {
            const message: Message = {
                id: uuidv4(),
                createdAt: getCurrentDate().toString(),
                body: req.body?.body.toString(),
                updatedAt: getCurrentDate().toString(),
                title: req.body?.title.toString(),
                attachmentURL: "",
            };
            messagesStorage.insert(message.id, message);
            res.json(message);
        });

        app.get("/messages", (req, res) => {
            res.json(messagesStorage.values());
        });

        app.get("/messages/:id", (req, res) => {
            const messageId = req.params.id;
            const messageOpt = messagesStorage.get(messageId);
            if ("None" in messageOpt) {
                res.status(404).send(`the message with id=${messageId} not found`);
            } else {
                res.json(messageOpt.Some);
            }
        });

        app.put("/messages/:id", (req, res) => {
            const messageId = req.params.id;
            const messageOpt = messagesStorage.get(messageId);
            if ("None" in messageOpt) {
                res
                    .status(400)
                    .send(
                        `couldn't update a message with id=${messageId}. message not found`,
                    );
            } else {
                const message = messageOpt.Some;
                const updatedMessage = {
                    ...message,
                    ...req.body,
                    updatedAt: getCurrentDate(),
                };
                messagesStorage.insert(message.id, updatedMessage);
                res.json(updatedMessage);
            }
        });

        app.delete("/messages/:id", (req, res) => {
            const messageId = req.params.id;
            const deletedMessage = messagesStorage.remove(messageId);
            if ("None" in deletedMessage) {
                res
                    .status(400)
                    .send(
                        `couldn't delete a message with id=${messageId}. message not found`,
                    );
            } else {
                res.json(deletedMessage.Some);
            }
        });

        return app.listen();
    },
    {
        getMessages: query([], Result(Vec(MessageIType), Error), () => {
            const data = messagesStorage.values();
            if (data.length <= 0) {
                return Err({NotFound: `there are no data`});
            }
            return Ok(messagesStorage.values());
        }),
        getKeys: query(
            [Opt(text), Opt(text)],
            Result(Vec(text), Error),
            (startIndex, lengthIndex) => {
                if ("None" in startIndex || "None" in lengthIndex) {
                    const storageLength = Number(messagesStorage.len());
                    return Ok(messagesStorage.keys(0, storageLength));
                }
                return Ok(
                    messagesStorage.keys(
                        Number(startIndex.Some),
                        Number(lengthIndex.Some),
                    ),
                );
            },
        ),
        getMessage: query([text], Result(MessageIType, Error), (id) => {
            if (!id) {
                return Err({InvalidPayload: "you provided wrong data"});
            }
            const message = messagesStorage.get(id);
            if ("None" in message) {
                return Err({NotFound: `the message with id=${id} not found`});
            }
            return Ok(message.Some);
        }),
        addMessage: update(
            [text, text],
            Result(MessageIType, Error),
            (messageTitle, messageText) => {
                if (!messageTitle || !messageText) {
                    return Err({InvalidPayload: "You didnt provide all the data, try again"});
                }
                //TODO: allow nullish instead of string
                const message: Message = {
                    id: uuidv4(),
                    createdAt: getCurrentDate().toString(),
                    body: messageText.toString(),
                    title: messageTitle.toString(),
                    attachmentURL: "",
                    updatedAt: getCurrentDate().toString(),
                };

                //TODO: what in case if there is no prev data in storage so we expect to get None but there is an error so it should return None instead of Some?
                //I believe it is a rust/ some low-code ability.

                const doubledMessage = messagesStorage.get(message.id);
                if ("Some" in doubledMessage) {
                    return Err({
                        DataExist: `Message with ID: ${message.id} exist. If you want to update please use 'update' message`,
                    });
                }

                messagesStorage.insert(message.id, message);
                return Ok(message);
            },
        ),
        resetStore: update([], Result(text, Error), () => {
            const messagesStorageLen = messagesStorage.len();
            if (+messagesStorageLen < 1) {
                return Err({NotFound: "Store is empty"});
            }

            const keys = messagesStorage.keys(0, +messagesStorageLen.toString());
            keys.forEach((key) => {
                messagesStorage.remove(key);
            });
            return Ok(`Removed ${messagesStorageLen.toString()} items`);
        }),
    },
);
